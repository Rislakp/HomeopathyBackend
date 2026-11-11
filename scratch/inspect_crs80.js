require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require("mongoose");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const course = await db.collection("courses").findOne({ courseId: "CRS-000080" });
  console.log("Course CRS-000080 found:", !!course);
  if (course) {
    console.log(JSON.stringify(course, null, 2));
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
