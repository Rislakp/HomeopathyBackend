const mongoose = require('mongoose');
require('dotenv').config();

const VERIFIED_ATTACHMENT_MIGRATION = {
  // Course CRS-000040: AIAPGET
  '6ac638f273250cecf366de3e': {
    title: 'Pharmacy OCT 6.pdf',
    s3Key: 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
    storageProvider: 's3',
    fileSize: 586976,
    bytes: 586976,
    size: 586976,
    contentType: 'application/pdf',
    mimetype: 'application/pdf',
    resourceType: 'pdf',
    uploadStatus: 'uploaded'
  },
  // Course CRS-000041: KPSC
  '6ac638dc73250cecf366ddca': {
    title: 'Pharmacy OCT 6.pdf',
    s3Key: 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
    storageProvider: 's3',
    fileSize: 586976,
    bytes: 586976,
    size: 586976,
    contentType: 'application/pdf',
    mimetype: 'application/pdf',
    resourceType: 'pdf',
    uploadStatus: 'uploaded'
  },
  // Course CRS-000042: UPSC
  '6ac6385b73250cecf366dd0f': {
    title: 'Pharmacy OCT 6.pdf',
    s3Key: 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
    storageProvider: 's3',
    fileSize: 586976,
    bytes: 586976,
    size: 586976,
    contentType: 'application/pdf',
    mimetype: 'application/pdf',
    resourceType: 'pdf',
    uploadStatus: 'uploaded'
  },
  // Course CRS-000070: COMBO COURSE - Pharmacy OCT 6.docx.pdf
  '6acf0ef592b8baa17a2b44e4': {
    title: 'Pharmacy OCT 6.docx.pdf',
    s3Key: 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
    storageProvider: 's3',
    fileSize: 586976,
    bytes: 586976,
    size: 586976,
    contentType: 'application/pdf',
    mimetype: 'application/pdf',
    resourceType: 'pdf',
    uploadStatus: 'uploaded'
  },
  // Course CRS-000070: COMBO COURSE - ASST PHARMACY (1).pdf
  '6acf0ef592b8baa17a2b44e5': {
    title: 'ASST PHARMACY (1).pdf',
    s3Key: 'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf',
    storageProvider: 's3',
    fileSize: 1439743,
    bytes: 1439743,
    size: 1439743,
    contentType: 'application/pdf',
    mimetype: 'application/pdf',
    resourceType: 'pdf',
    uploadStatus: 'uploaded'
  }
};

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  const Course = require('../models/Course');

  const courseIds = ['CRS-000040', 'CRS-000041', 'CRS-000042', 'CRS-000070'];
  let updatedCount = 0;

  for (const cid of courseIds) {
    const courseDoc = await Course.findOne({ courseId: cid });
    if (!courseDoc) continue;

    let modified = false;
    for (const m of courseDoc.modules || []) {
      for (const l of m.lessons || []) {
        for (const item of l.attachments || []) {
          const idStr = item._id.toString();
          if (VERIFIED_ATTACHMENT_MIGRATION[idStr]) {
            const patch = VERIFIED_ATTACHMENT_MIGRATION[idStr];
            console.log(`Migrating item [${idStr}] (${patch.title}) in course [${cid}]...`);
            item.s3Key = patch.s3Key;
            item.storageProvider = patch.storageProvider;
            item.fileSize = patch.fileSize;
            item.bytes = patch.bytes;
            item.size = patch.size;
            item.contentType = patch.contentType;
            item.mimetype = patch.mimetype;
            item.resourceType = patch.resourceType;
            item.uploadStatus = patch.uploadStatus;
            modified = true;
            updatedCount++;
          }
        }
      }
    }

    if (modified) {
      await courseDoc.save();
      console.log(`Saved updated course [${cid}].`);
    }
  }

  console.log(`Migration complete. Successfully migrated ${updatedCount} attachments.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
