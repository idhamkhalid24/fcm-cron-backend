const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');

// 1. Initialize Supabase Client
// We will set these variables in Vercel Environment Variables later
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 2. Initialize Firebase Admin SDK
// We need the service account from Firebase Console > Project Settings > Service Accounts
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('Firebase Admin initialization error', error.stack);
  }
}

export default async function handler(req, res) {
  try {
    // We expect the schedule table to have: id, user_id, fcm_token, schedule_time, status, title, description
    // Get current time in ISO format to compare with schedule_time
    const now = new Date().toISOString();

    // Query Supabase for schedules that are due (schedule_time <= now) and haven't been sent yet
    const { data: schedules, error } = await supabase
      .from('schedules')
      .select('*')
      .lte('schedule_time', now)
      .eq('status', 'pending');

    if (error) {
      console.error('Error fetching schedules from Supabase:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!schedules || schedules.length === 0) {
      return res.status(200).json({ message: 'No pending schedules at this time.' });
    }

    const promises = schedules.map(async (schedule) => {
      if (!schedule.fcm_token) return;

      const message = {
        notification: {
          title: schedule.title || 'Jadwal Tiba!',
          body: schedule.description || 'Ada jadwal yang harus kamu kerjakan sekarang.'
        },
        token: schedule.fcm_token
      };

      try {
        // Send push notification
        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
        
        // Update status in Supabase so we don't send it again
        await supabase
          .from('schedules')
          .update({ status: 'sent' })
          .eq('id', schedule.id);
          
      } catch (err) {
        console.error('Error sending message for schedule ID', schedule.id, ':', err);
      }
    });

    await Promise.all(promises);

    res.status(200).json({ message: `Successfully processed ${schedules.length} schedules.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
