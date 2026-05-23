const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function testUpload() {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream('c:\\stark-drive\\docker-compose.yml'));
    formData.append('originalName', 'test.yml');
    formData.append('isVault', 'false');

    console.log('Sending request...');
    const res = await axios.post('http://localhost:8080/api/v1/drive/upload', formData, {
      headers: {
        ...formData.getHeaders(),
        // We don't have a token, so we expect a 401 Unauthorized or 403 Forbidden
      }
    });
    console.log('Response:', res.status);
  } catch (err) {
    console.log('Error:', err.message);
    if (err.response) {
      console.log('Error Status:', err.response.status);
    }
  }
}

testUpload();
