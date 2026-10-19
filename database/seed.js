import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { connectDatabase } from '../server/config/database.js';
import { Department, Notification, RequestComment, RequestStatusHistory, Service, ServiceRequest, User } from '../server/models/index.js';
import { nextReference } from '../server/utils/helpers.js';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
  console.error('Refusing to seed in production. Set ALLOW_SEED=true only if you really intend to.'); process.exit(1);
}
await connectDatabase(process.env.MONGODB_URI);
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Demo#2026pass';
const passwordHash = await bcrypt.hash(PASSWORD, 12);

await Notification.deleteMany({});
await RequestComment.deleteMany({});
await RequestStatusHistory.deleteMany({});
await ServiceRequest.deleteMany({});
await Service.deleteMany({});
await Department.deleteMany({});

const deptData = [
  ['Public Works', 'Department responsible for roads, street infrastructure, and public works maintenance.'],
  ['Water and Sanitation', 'Department responsible for drainage, water services, waste management, and sanitation.'],
  ['County Services', 'Department responsible for public amenities, community services, and health-related complaints.']
];
const depts = {};
for (const [name, description] of deptData) depts[name] = await Department.findOneAndUpdate({ name }, { name, description, contactInformation: 'service@county.gov', status: 'active' }, { upsert: true, returnDocument: 'after' });

const svc = [
  ['Pothole or Damaged Road', 'Public Works', '🚧', 'Report potholes, cracks or damaged road surfaces that are unsafe for drivers or pedestrians.', 7, 'Tell us the exact road or landmark and how big the damage is. A clear photo helps the officer find and assess it quickly.', ['Road name or nearest landmark', 'Size of the damage (small, medium or large)', 'Whether it is a safety hazard']],
  ['Blocked Drainage', 'Water and Sanitation', '🌊', 'Report blocked drains or flooding caused by clogged drainage channels.', 3, 'Describe where the water is collecting and since when. Add a photo if it is safe to take one.', ['Exact location of the blocked drain', 'How long it has been blocked', 'Whether water is entering homes or businesses']],
  ['Burst Water Pipe', 'Water and Sanitation', '💧', 'Report burst or leaking water pipes that are wasting water or flooding an area.', 2, 'Give the closest street, plot or landmark. If the leak is large, mention it so it can be prioritised.', ['Location of the leak', 'Approximate size of the leak', 'Date you first noticed it']],
  ['Illegal Dumping', 'Water and Sanitation', '♻️', 'Report garbage dumped in open spaces, roadsides or drainage channels.', 4, 'Describe the type of waste and how much there is. Do not touch hazardous waste. A photo from a safe distance is enough.', ['Location of the dumped waste', 'Type of waste (household, construction, other)', 'Approximate amount']],
  ['Faulty Traffic Light', 'Public Works', '🚦', 'Report traffic lights that are not working, stuck or showing the wrong signals.', 3, 'Name the junction and describe what the lights are doing. Mention the time of day if it happens only at certain hours.', ['Name of the junction', 'What is wrong with the lights', 'Time of day it happens']],
  ['Public Park Maintenance', 'County Services', '🌳', 'Report overgrown grass, broken benches or damaged play equipment in public parks.', 10, 'Name the park and describe the problem. Mention any safety risk for children or visitors.', ['Name of the park or open space', 'What needs fixing', 'Any safety risk']],
  ['Public Health Nuisance', 'County Services', '🦟', 'Report health nuisances such as stagnant water, overflowing public toilets or pest infestations.', 5, 'Describe the problem and where it is. Please do not include personal details of other people in photos.', ['Location of the nuisance', 'Type of nuisance', 'How long it has been a problem']]
];
const services = [];
for (const [name, dept, icon, description, days, instructions, requiredInformation] of svc) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') || 'service';
  services.push(await Service.findOneAndUpdate({ slug }, {
    name, slug, icon, description, department: depts[dept]._id, estimatedProcessingDays: days, status: 'active', instructions, requiredInformation
  }, { upsert: true, returnDocument: 'after' }));
}

const person = async (fullName, email, role, department = null) => {
  await User.updateOne({ email }, { $set: { fullName, email, role, department, passwordHash, accountStatus: 'active' } }, { upsert: true });
  return User.findOne({ email });
};
const admin = await person('Demo Administrator', 'admin@psrs.test', 'admin');
const offPublic = await person('Amina Officer', 'officer1@psrs.test', 'officer', depts['Public Works']._id);
const offWater = await person('Brian Officer', 'officer2@psrs.test', 'officer', depts['Water and Sanitation']._id);
const offCounty = await person('Cynthia Officer', 'officer3@psrs.test', 'officer', depts['County Services']._id);
await person('Dan Officer', 'officer4@psrs.test', 'officer', depts['Public Works']._id);
await person('Eunice Officer', 'officer5@psrs.test', 'officer', depts['Water and Sanitation']._id);
await person('Felix Officer', 'officer6@psrs.test', 'officer', depts['County Services']._id);
const c1 = await person('Wanjiru Citizen', 'citizen1@psrs.test', 'citizen');
const c2 = await person('Otieno Citizen', 'citizen2@psrs.test', 'citizen');
await person('Fatuma Citizen', 'citizen3@psrs.test', 'citizen');

const staffByDepartment = {
  [String(depts['Public Works']._id)]: offPublic,
  [String(depts['Water and Sanitation']._id)]: offWater,
  [String(depts['County Services']._id)]: offCounty
};

if (await ServiceRequest.estimatedDocumentCount() === 0) {
  const today = new Date();
  const seededStatuses = Array(7).fill('SUBMITTED');
  let i = 0;
  for (const status of seededStatuses) {
    const service = services[i % services.length];
    const citizen = i % 2 ? c2 : c1;
    const req = await ServiceRequest.create({
      referenceNumber: await nextReference(), citizen: citizen._id, service: service._id, department: service.department,
      assignedOfficer: null, title: `${service.name} (sample ${i + 1})`,
      description: 'Demonstration request created by the seed script. This is fictional data.', location: 'Muranga County',
      status, submittedAt: today, resolvedAt: undefined, resolutionSummary: undefined
    });
    await RequestStatusHistory.create({ request: req._id, previousStatus: null, newStatus: status, changedBy: citizen._id, comment: 'Request submitted' });
    await Notification.create({ recipient: citizen._id, request: req._id, title: 'Request submitted', message: `${req.referenceNumber} has been submitted successfully.` });
    i++;
  }
}
console.log(`Seed complete. Demo password for all demo accounts: ${PASSWORD}\n  admin@psrs.test, officer1@psrs.test, officer2@psrs.test, citizen1@psrs.test`);
await mongoose.disconnect();
