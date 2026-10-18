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

const deptData = [
  ['Civil Registration', 'Demonstration registry for birth and identity inquiries.'],
  ['Trade and Licensing', 'Demonstration office for business permit assistance.'],
  ['Lands and Housing', 'Demonstration office for land records inquiries.'],
  ['County Services', 'Demonstration office for complaints, infrastructure and social services.'],
  ['Public Works', 'Demonstration office for roads, street lighting and drainage.'],
  ['Water and Sanitation', 'Demonstration office for water supply and garbage collection.']
];
const depts = {};
for (const [name, description] of deptData) depts[name] = await Department.findOneAndUpdate({ name }, { name, description, contactInformation: 'demo@example.org', status: 'active' }, { upsert: true, returnDocument: 'after' });

const svc = [
  ['Birth Registration Service Inquiry', 'Civil Registration', '🍼', 'Ask about the status or requirements for a birth registration.', 10],
  ['National Identification Service Inquiry', 'Civil Registration', '🪪', 'Ask about identification application requirements and progress.', 14],
  ['Business Permit Assistance', 'Trade and Licensing', '🏪', 'Get help understanding and applying for a business permit.', 7],
  ['Land Records Inquiry', 'Lands and Housing', '🗺️', 'Request help locating or understanding a land record.', 21],
  ['County Service Complaint', 'County Services', '📣', 'Report a problem with a county service you received.', 7],
  ['Public Infrastructure Complaint', 'County Services', '🚧', 'Report damaged roads, lights, drains or other public infrastructure.', 5],
  ['Social Services Assistance', 'County Services', '🤝', 'Ask about available social support programmes.', 14],
  ['General Public Inquiry', 'County Services', '💬', 'Ask any other question about public services.', 3],
  ['Broken Streetlight', 'Public Works', '💡', 'Report a streetlight that is broken, flickering or always on.', 5],
  ['Water Issue', 'Water and Sanitation', '🚰', 'Report water shortages, leaks, burst pipes or dirty water.', 3],
  ['Garbage Collection', 'Water and Sanitation', '🗑️', 'Report missed garbage collection or illegal dumping.', 2]
];
const services = [];
for (const [name, dept, icon, description, days] of svc) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  services.push(await Service.findOneAndUpdate({ slug }, {
    name, slug, icon, description, department: depts[dept]._id, estimatedProcessingDays: days, status: 'active',
    instructions: 'Describe your situation clearly and attach supporting documents if you have them. This is a demonstration service.',
    requiredInformation: ['A clear description of the issue', 'Relevant location or reference numbers']
  }, { upsert: true, returnDocument: 'after' }));
}

const person = async (fullName, email, role, department = null) => {
  await User.updateOne({ email }, { $set: { fullName, email, role, department, passwordHash, accountStatus: 'active' } }, { upsert: true });
  return User.findOne({ email });
};
const admin = await person('Demo Administrator', 'admin@psrs.test', 'admin');
const off1 = await person('Amina Officer', 'officer1@psrs.test', 'officer', depts['County Services']._id);
const off2 = await person('Brian Officer', 'officer2@psrs.test', 'officer', depts['Civil Registration']._id);
await person('Cynthia Officer', 'officer3@psrs.test', 'officer', depts['Public Works']._id);
await person('Dan Officer', 'officer4@psrs.test', 'officer', depts['Water and Sanitation']._id);
const c1 = await person('Wanjiru Citizen', 'citizen1@psrs.test', 'citizen');
const c2 = await person('Otieno Citizen', 'citizen2@psrs.test', 'citizen');
await person('Fatuma Citizen', 'citizen3@psrs.test', 'citizen');

if (await ServiceRequest.estimatedDocumentCount() === 0) {
  const flows = [
    ['SUBMITTED'], ['SUBMITTED', 'UNDER_REVIEW'], ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INFORMATION'],
    ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS'], ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED'],
    ['SUBMITTED', 'UNDER_REVIEW', 'REJECTED'], ['SUBMITTED', 'CANCELLED']
  ];
  let i = 0;
  for (const flow of flows) {
    const service = services[(i + 4) % services.length]; // mostly County Services so officer1 has work
    const citizen = i % 2 ? c2 : c1;
    const staff = String(service.department) === String(depts['Civil Registration']._id) ? off2 : off1;
    const status = flow.at(-1);
    const submittedAt = new Date(Date.now() - (20 - i * 2) * 86400000);
    const req = await ServiceRequest.create({
      referenceNumber: await nextReference(), citizen: citizen._id, service: service._id, department: service.department,
      assignedOfficer: flow.length > 1 ? staff._id : null, title: `${service.name} (sample ${i + 1})`,
      description: 'Demonstration request created by the seed script. This is fictional data.', location: 'Nairobi',
      status, submittedAt, resolvedAt: status === 'RESOLVED' ? new Date(submittedAt.getTime() + 6 * 86400000) : undefined,
      resolutionSummary: status === 'RESOLVED' ? 'Sample resolution: guidance provided to the citizen.' : undefined
    });
    for (let s = 0; s < flow.length; s++) {
      await RequestStatusHistory.create({ request: req._id, previousStatus: s ? flow[s - 1] : null, newStatus: flow[s], changedBy: s ? staff._id : citizen._id, comment: s ? `Moved to ${flow[s]}` : 'Request submitted' });
    }
    await Notification.create({ recipient: citizen._id, request: req._id, title: 'Request update', message: `${req.referenceNumber} is ${status.replace(/_/g, ' ').toLowerCase()}.` });
    if (flow.length > 1) await RequestComment.create({ request: req._id, author: staff._id, comment: 'Internal sample note: checked supporting details.', visibility: 'internal' });
    i++;
  }
}
console.log(`Seed complete. Demo password for all demo accounts: ${PASSWORD}\n  admin@psrs.test, officer1@psrs.test, officer2@psrs.test, citizen1@psrs.test`);
await mongoose.disconnect();
