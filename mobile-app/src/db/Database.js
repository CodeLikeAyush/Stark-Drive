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
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY NOT NULL,
        uri TEXT,
        filename TEXT NOT NULL,
        creation_time INTEGER NOT NULL,
        local_path TEXT,
        is_available_offline INTEGER DEFAULT 0,
        remote_file_id TEXT
      );
      
      CREATE TABLE IF NOT EXISTS action_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    
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
    `INSERT INTO files (id, is_vault, parent_id, original_filename, content_type, size_bytes, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       is_vault=excluded.is_vault, 
       parent_id=excluded.parent_id, 
       original_filename=excluded.original_filename, 
       content_type=excluded.content_type, 
       size_bytes=excluded.size_bytes, 
       created_at=excluded.created_at`,
    [file.id.toString(), isVault, file.parentId ? file.parentId.toString() : null, file.originalFilename || 'Unknown', file.contentType || null, file.sizeBytes || 0, Date.now()]
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
    `INSERT INTO photos (id, uri, filename, creation_time, remote_file_id) 
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       uri=excluded.uri, 
       filename=excluded.filename, 
       creation_time=excluded.creation_time, 
       remote_file_id=excluded.remote_file_id`,
    [photo.id.toString(), photo.uri || null, photo.filename || 'Unknown', photo.creationTime || Date.now(), photo.remoteFileId ? photo.remoteFileId.toString() : null]
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
