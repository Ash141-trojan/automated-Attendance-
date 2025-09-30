require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

// MongoDB connection
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_db';
mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// Attendance Mongoose model
const attendanceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  deviceName: { type: String },
  timestamp: { type: Date, required: true, index: true },
  battery: { type: Number },
}, { timestamps: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

// Routes

// POST /api/attendance
app.post('/api/attendance', async (req, res) => {
  try {
    const { deviceId, deviceName, timestamp, battery } = req.body;
    if (!deviceId || !timestamp) return res.status(400).json({ error: 'deviceId and timestamp required' });

    const entry = new Attendance({ deviceId, deviceName, timestamp: new Date(timestamp), battery });
    const saved = await entry.save();
    return res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/attendance  (list with optional filters)
app.get('/api/attendance', async (req, res) => {
  try {
    const { from, to, deviceId, limit } = req.query;
    const q = {};
    if (deviceId) q.deviceId = deviceId;
    if (from || to) q.timestamp = {};
    if (from) q.timestamp.$gte = new Date(from);
    if (to) q.timestamp.$lte = new Date(to);

    const L = parseInt(limit) || 100;
    const results = await Attendance.find(q).sort({ timestamp: -1 }).limit(L).lean();
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/attendance/stats  (aggregated counts per day for past N days)
app.get('/api/attendance/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const start = new Date();
    start.setUTCHours(0,0,0,0);
    start.setDate(start.getDate() - (days - 1));

    const pipeline = [
      { $match: { timestamp: { $gte: start } } },
      { $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ];

    const agg = await Attendance.aggregate(pipeline);
    // Ensure we return consecutive days (including 0 counts)
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const s = d.toISOString().slice(0,10);
      const found = agg.find(a => a._id === s);
      out.push({ date: s, count: found ? found.count : 0 });
    }

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Simple health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

// Serve static frontend when deployed together (optional)
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'))); // put your index.html into public/

const PORT = parseInt(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
