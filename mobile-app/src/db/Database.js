import * as SQLite from 'expo-sqlite';

let db = null;

export const initDB = async () => {
  if (db) return db;
  
  try {
    db = await SQLite.openDatabaseAsync('starkdrive.db');
    
    // Create tables
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS offline_files;
      DROP TABLE IF EXISTS offline_photos;
      
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY NOT NULL,
        is_vault INTEGER NOT NULL,
        parent_id TEXT,
        original_filename TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER,
        local_path TEXT,
        is_available_offline INTEGER DEFAULT 0,
        has_thumbnail INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY NOT NULL,
        uri TEXT,
        filename TEXT NOT NULL,
        creation_time INTEGER NOT NULL,
        local_path TEXT,
        is_available_offline INTEGER DEFAULT 0,
        remote_file_id TEXT,
        has_thumbnail INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS action_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        cover_photo_id TEXT,
        photo_count INTEGER DEFAULT 0,
        creation_time INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS album_photos (
        album_id TEXT NOT NULL,
        photo_id TEXT NOT NULL,
        PRIMARY KEY (album_id, photo_id)
      );
    `);

    // Migration: Add has_thumbnail column to files table if it doesn't exist
    try {
      await db.execAsync(`ALTER TABLE files ADD COLUMN has_thumbnail INTEGER DEFAULT 0;`);
      console.log("Migration: added has_thumbnail column to files table");
    } catch (e) {
      // Column probably already exists, which is fine
    }

    // Migration: Add has_thumbnail column to photos table if it doesn't exist
    try {
      await db.execAsync(`ALTER TABLE photos ADD COLUMN has_thumbnail INTEGER DEFAULT 0;`);
      console.log("Migration: added has_thumbnail column to photos table");
    } catch (e) {
      // Column probably already exists, which is fine
    }
    
    console.log("Database initialized successfully");
    return db;
  } catch (error) {
    console.error("Failed to initialize database", error);
    throw error;
  }
};

export const getDB = () => {
  if (!db) {
    db = SQLite.openDatabaseSync('starkdrive.db');
  }
  return db;
};

// --- Files ---

export const upsertFileCache = async (file, isVault = 0) => {
  const database = getDB();
  await database.runAsync(
    `INSERT INTO files (id, is_vault, parent_id, original_filename, content_type, size_bytes, has_thumbnail, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       is_vault=excluded.is_vault, 
       parent_id=excluded.parent_id, 
       original_filename=excluded.original_filename, 
       content_type=excluded.content_type, 
       size_bytes=excluded.size_bytes, 
       has_thumbnail=excluded.has_thumbnail,
       created_at=excluded.created_at`,
    [file.id.toString(), isVault, file.parentId ? file.parentId.toString() : null, file.originalFilename || 'Unknown', file.contentType || null, file.sizeBytes || 0, file.hasThumbnail ? 1 : 0, Date.now()]
  );
};

export const markFileAvailableOffline = async (id, localPath) => {
  const database = getDB();
  await database.runAsync(`UPDATE files SET local_path = ?, is_available_offline = 1 WHERE id = ?`, [localPath, id.toString()]);
};

export const markFileNotAvailableOffline = async (id) => {
  const database = getDB();
  await database.runAsync(`UPDATE files SET local_path = NULL, is_available_offline = 0 WHERE id = ?`, [id.toString()]);
};

export const getFilesByParent = async (parentId, isVault = 0) => {
  const database = getDB();
  if (parentId) {
    return await database.getAllAsync(`SELECT * FROM files WHERE is_vault = ? AND parent_id = ?`, [isVault, parentId.toString()]);
  } else {
    return await database.getAllAsync(`SELECT * FROM files WHERE is_vault = ? AND parent_id IS NULL`, [isVault]);
  }
};

export const getOfflineFiles = async (isVault = 0) => {
  const database = getDB();
  return await database.getAllAsync(`SELECT * FROM files WHERE is_vault = ? AND is_available_offline = 1`, [isVault]);
};

export const getFile = async (id) => {
  const database = getDB();
  return await database.getFirstAsync(`SELECT * FROM files WHERE id = ?`, [id.toString()]);
};

export const deleteFile = async (id) => {
  const database = getDB();
  await database.runAsync(`DELETE FROM files WHERE id = ?`, [id.toString()]);
};

// --- Photos ---

export const upsertPhotoCache = async (photo) => {
  const database = getDB();
  await database.runAsync(
    `INSERT INTO photos (id, uri, filename, creation_time, remote_file_id, has_thumbnail) 
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       uri=excluded.uri, 
       filename=excluded.filename, 
       creation_time=excluded.creation_time, 
       remote_file_id=excluded.remote_file_id,
       has_thumbnail=excluded.has_thumbnail`,
    [
      photo.id.toString(),
      photo.uri || null,
      photo.filename || 'Unknown',
      photo.creationTime || Date.now(),
      photo.remoteFileId ? photo.remoteFileId.toString() : null,
      photo.hasThumbnail ? 1 : 0
    ]
  );
};

export const markPhotoAvailableOffline = async (id, localPath) => {
  const database = getDB();
  await database.runAsync(`UPDATE photos SET local_path = ?, is_available_offline = 1 WHERE id = ?`, [localPath, id.toString()]);
};

export const markPhotoNotAvailableOffline = async (id) => {
  const database = getDB();
  await database.runAsync(`UPDATE photos SET local_path = NULL, is_available_offline = 0 WHERE id = ?`, [id.toString()]);
};

export const getPhotos = async () => {
  const database = getDB();
  return await database.getAllAsync(`SELECT * FROM photos ORDER BY creation_time DESC`);
};

// --- Albums ---

export const upsertAlbumCache = async (album) => {
  const database = getDB();
  await database.runAsync(
    `INSERT INTO albums (id, name, description, cover_photo_id, photo_count, creation_time) 
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       name=excluded.name, 
       description=excluded.description, 
       cover_photo_id=excluded.cover_photo_id, 
       photo_count=excluded.photo_count,
       creation_time=excluded.creation_time`,
    [
      album.id.toString(),
      album.name || 'Untitled Album',
      album.description || null,
      album.coverPhotoId ? album.coverPhotoId.toString() : null,
      album.photoCount || 0,
      album.creationTime || Date.now()
    ]
  );
};

export const upsertAlbumPhotosCache = async (albumId, photoIds) => {
  const database = getDB();
  // Clear existing relationships for this album first
  await database.runAsync(`DELETE FROM album_photos WHERE album_id = ?`, [albumId.toString()]);
  
  // Insert new relationships
  for (const photoId of photoIds) {
    await database.runAsync(
      `INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?, ?)`,
      [albumId.toString(), photoId.toString()]
    );
  }
};

export const getCachedAlbums = async () => {
  const database = getDB();
  return await database.getAllAsync(`SELECT * FROM albums ORDER BY creation_time DESC`);
};

export const getCachedAlbum = async (albumId) => {
  const database = getDB();
  return await database.getFirstAsync(`SELECT * FROM albums WHERE id = ?`, [albumId.toString()]);
};


export const getCachedAlbumPhotos = async (albumId) => {
  const database = getDB();
  return await database.getAllAsync(
    `SELECT p.* FROM photos p 
     INNER JOIN album_photos ap ON p.id = ap.photo_id 
     WHERE ap.album_id = ? 
     ORDER BY p.creation_time DESC`,
    [albumId.toString()]
  );
};

export const deleteAlbumCache = async (albumId) => {
  const database = getDB();
  await database.runAsync(`DELETE FROM albums WHERE id = ?`, [albumId.toString()]);
  await database.runAsync(`DELETE FROM album_photos WHERE album_id = ?`, [albumId.toString()]);
};
