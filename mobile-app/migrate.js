const crypto = require('crypto');
const CryptoJS = require('crypto-js');

if (process.argv.length < 6) {
  console.log("Usage: node migrate.js <serverUrl> <email> <password> <pin>");
  console.log("Example: node migrate.js http://localhost:8080 user@example.com mypassword ***PIN***");
  process.exit(1);
}

const serverUrl = process.argv[2];
const email = process.argv[3];
const password = process.argv[4];
const pin = process.argv[5];

async function run() {
  try {
    console.log("Step 1: Authenticating to server...");
    const loginRes = await fetch(`${serverUrl}/api/v1/auth/authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (!loginRes.ok) {
      const errorText = await loginRes.text();
      throw new Error(`Authentication failed: ${loginRes.status} - ${errorText}`);
    }

    const authData = await loginRes.json();
    const token = authData.token;
    const encryptedVaultKey = authData.encryptedVaultKey;

    if (!encryptedVaultKey) {
      throw new Error("Vault is not setup for this user on the server (missing encryptedVaultKey).");
    }

    console.log("Step 2: Deriving Master Key from PIN...");
    const kek = crypto.createHash('sha256').update(pin).digest('hex');
    const decryptedBytes = CryptoJS.AES.decrypt(encryptedVaultKey, kek);
    const masterKey = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!masterKey) {
      throw new Error("Invalid PIN. Could not decrypt the Master Key package.");
    }
    console.log("Master Key successfully derived!");

    console.log("Step 3: Fetching vault files...");
    const listRes = await fetch(`${serverUrl}/api/v1/drive/vault/list`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!listRes.ok) {
      throw new Error(`Failed to fetch vault list: ${listRes.status}`);
    }

    const files = await listRes.json();
    console.log(`Found ${files.length} files in the vault.`);

    let migratedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const file of files) {
      console.log(`Processing file: "${file.originalFilename}" (ID: ${file.id})...`);
      
      const downloadRes = await fetch(`${serverUrl}/api/v1/drive/download/${file.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!downloadRes.ok) {
        console.error(`  [Error] Failed to download file content (status ${downloadRes.status})`);
        failedCount++;
        continue;
      }

      const fileCiphertext = await downloadRes.text();

      // Try decrypting with KEK derived from PIN (old method)
      let decryptedBytesText;
      try {
        const bytes = CryptoJS.AES.decrypt(fileCiphertext, kek);
        decryptedBytesText = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedBytesText) {
          throw new Error("Empty decrypted content");
        }
      } catch (e) {
        console.log(`  [Skip] File is already encrypted with Master Key or is not legacy.`);
        skippedCount++;
        continue;
      }

      // Re-encrypt base64 data using the derived Master Key (DEK)
      const newCiphertext = CryptoJS.AES.encrypt(decryptedBytesText, masterKey).toString();

      // Upload newly encrypted file back to server
      const formData = new FormData();
      const blob = new Blob([newCiphertext], { type: 'application/octet-stream' });
      formData.append('file', blob, file.originalFilename);
      formData.append('isVault', 'true');
      formData.append('originalName', file.originalFilename);

      const uploadRes = await fetch(`${serverUrl}/api/v1/drive/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        console.error(`  [Error] Failed to upload new version: ${uploadRes.status} - ${errorText}`);
        failedCount++;
        continue;
      }

      // Delete the old file from server
      const deleteRes = await fetch(`${serverUrl}/api/v1/drive/items/file/${file.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (deleteRes.ok) {
        console.log(`  [Success] File successfully migrated and re-encrypted!`);
        migratedCount++;
      } else {
        console.warn(`  [Warning] Uploaded new version, but failed to delete old file (ID: ${file.id}).`);
        failedCount++;
      }
    }

    console.log("\n------------------------------------------------");
    console.log("Migration Summary:");
    console.log(`  Successfully Migrated: ${migratedCount}`);
    console.log(`  Skipped (Already OK):  ${skippedCount}`);
    console.log(`  Failed:                ${failedCount}`);
    console.log("------------------------------------------------");

  } catch (error) {
    console.error("Migration failed:", error.message);
  }
}

run();
