const fs = require('fs');
const path = require('path');

try {
    const apiFile = path.resolve('api', 'assign-mmsi.js');
    if (fs.existsSync(apiFile)) {
        fs.unlinkSync(apiFile);
        console.log('Deleted api/assign-mmsi.js');
    }

    const apiDir = path.resolve('api');
    if (fs.existsSync(apiDir)) {
        try {
            fs.rmdirSync(apiDir);
            console.log('Deleted api directory');
        } catch (err) {
            console.log('api directory not empty or busy');
        }
    }

    const vercelFile = path.resolve('vercel.json');
    if (fs.existsSync(vercelFile)) {
        fs.unlinkSync(vercelFile);
        console.log('Deleted vercel.json');
    }
} catch (e) {
    console.error('Error during cleanup:', e);
}
