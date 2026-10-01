/**
 * Migration & Repair Script: Demo Videos Course ID Enforcement
 *
 * Inspects all DemoVideo records in MongoDB:
 * 1. Identifies demo videos with missing or null courseId.
 * 2. If a demo video has a legacy ObjectId courseRef, resolves the proper Course.courseId string (e.g. "CRS-000039").
 * 3. Reports unassigned / orphaned demo videos without silently attaching them to an arbitrary course.
 * 4. Supports manual assignment via arguments:
 *    node scripts/migrate_demo_videos_course_id.js --assign <demoVideoId>=<courseId>
 *
 * Usage:
 *   node scripts/migrate_demo_videos_course_id.js
 *   node scripts/migrate_demo_videos_course_id.js --assign 65e2b3c4d5e6f7a8b9c0d555=CRS-000039
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const DemoVideo = require('../models/DemoVideo');
const Course = require('../models/Course');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/homeopathy';

async function runMigration() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected successfully.\n');

    // Parse command line arguments for manual assignment
    const args = process.argv.slice(2);
    const assignIndex = args.indexOf('--assign');
    if (assignIndex !== -1 && args[assignIndex + 1]) {
      const pair = args[assignIndex + 1];
      const [demoId, targetCourseId] = pair.split('=');

      if (!demoId || !targetCourseId) {
        console.error('Invalid format for --assign. Use: --assign <demoVideoId>=<courseId>');
        process.exit(1);
      }

      console.log(`[ASSIGN] Attempting to assign DemoVideo "${demoId}" to Course "${targetCourseId}"...`);
      const courseQuery = [{ courseId: targetCourseId.trim() }];
      if (mongoose.Types.ObjectId.isValid(targetCourseId.trim())) {
        courseQuery.push({ _id: new mongoose.Types.ObjectId(targetCourseId.trim()) });
      }

      const foundCourse = await Course.findOne({ $or: courseQuery });
      if (!foundCourse) {
        console.error(`Error: Course "${targetCourseId}" not found in database.`);
        process.exit(1);
      }

      const canonicalCourseId = foundCourse.courseId || targetCourseId.trim();
      const updated = await DemoVideo.findByIdAndUpdate(
        demoId.trim(),
        {
          $set: {
            courseId: canonicalCourseId,
            courseRef: foundCourse._id,
          }
        },
        { new: true }
      );

      if (!updated) {
        console.error(`Error: DemoVideo "${demoId}" not found.`);
        process.exit(1);
      }

      console.log(`Successfully assigned DemoVideo "${updated.title}" (${updated._id}) to course "${canonicalCourseId}" (${foundCourse.courseTitle}).\n`);
    }

    // Inspect all demo videos
    const allDemos = await DemoVideo.find({}).lean();
    console.log(`Found ${allDemos.length} total demo video records.\n`);

    const validDemos = [];
    const legacyObjectIdDemos = [];
    const orphanedDemos = [];

    for (const demo of allDemos) {
      if (demo.courseId && typeof demo.courseId === 'string' && demo.courseId.trim() !== '' && demo.courseId !== 'null') {
        // If courseId looks like an ObjectId, check if we can resolve the CRS-xxxxxx string
        if (mongoose.Types.ObjectId.isValid(demo.courseId) && !demo.courseId.startsWith('CRS-')) {
          legacyObjectIdDemos.push(demo);
        } else {
          validDemos.push(demo);
        }
      } else if (demo.courseRef) {
        legacyObjectIdDemos.push(demo);
      } else {
        orphanedDemos.push(demo);
      }
    }

    // Fix legacy ObjectId course references
    if (legacyObjectIdDemos.length > 0) {
      console.log(`Resolving ${legacyObjectIdDemos.length} demo videos with legacy ObjectId course references...`);
      for (const demo of legacyObjectIdDemos) {
        const refId = demo.courseRef || demo.courseId;
        const foundCourse = await Course.findById(refId);
        if (foundCourse && foundCourse.courseId) {
          await DemoVideo.findByIdAndUpdate(demo._id, {
            $set: {
              courseId: foundCourse.courseId,
              courseRef: foundCourse._id,
            }
          });
          console.log(`  Updated Demo "${demo.title}" (${demo._id}) -> courseId: "${foundCourse.courseId}"`);
        } else if (foundCourse) {
          await DemoVideo.findByIdAndUpdate(demo._id, {
            $set: {
              courseId: foundCourse._id.toString(),
              courseRef: foundCourse._id,
            }
          });
          console.log(`  Updated Demo "${demo.title}" (${demo._id}) -> courseId: "${foundCourse._id}"`);
        }
      }
      console.log('');
    }

    console.log('----------------------------------------------------');
    console.log(`Summary of Demo Videos:`);
    console.log(`  - Valid Course-Specific Demos : ${validDemos.length + legacyObjectIdDemos.length}`);
    console.log(`  - Unassigned / courseId null  : ${orphanedDemos.length}`);
    console.log('----------------------------------------------------');

    if (orphanedDemos.length > 0) {
      console.log('\nWarning: The following demo videos have courseId: null and will NOT appear in course-specific views:');
      orphanedDemos.forEach((d, idx) => {
        console.log(`  ${idx + 1}. ID: ${d._id} | Title: "${d.title}" | URL: ${d.videoUrl}`);
      });
      console.log('\nTo assign an unassigned demo video to a course, run:');
      console.log('  node scripts/migrate_demo_videos_course_id.js --assign <demoVideoId>=<courseId>');
    } else {
      console.log('\nAll demo videos are properly associated with a valid courseId.');
    }

    await mongoose.disconnect();
    console.log('\nMigration check complete.');
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
