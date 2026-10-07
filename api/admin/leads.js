// Admin-only lead access: GET lists, PATCH updates status or notes, DELETE
// removes. Requires the signed session cookie from /api/admin/session.
const auth = require('../lib/admin-auth');
const store = require('../lib/store');
const { STATUSES, clean } = require('../lib/lead-record');

const CID_RE = /^[A-Za-z0-9-]{16,64}$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!auth.isAuthed(req)) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  try {
    if (req.method === 'GET') {
      res.status(200).json({ storage: store.mode(), leads: await store.listLeads() });
      return;
    }

    const body = req.body || {};
    if (!CID_RE.test(String(body.cid || ''))) {
      res.status(400).json({ error: 'invalid cid' });
      return;
    }

    if (req.method === 'PATCH') {
      const lead = await store.getLead(body.cid);
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) {
          res.status(400).json({ error: 'invalid status' });
          return;
        }
        lead.status = body.status;
      }
      if (body.notes !== undefined) lead.notes = clean(String(body.notes), 2000);
      await store.putLead(lead.cid, lead);
      res.status(200).json({ ok: true, lead });
      return;
    }

    if (req.method === 'DELETE') {
      await store.deleteLead(body.cid);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin leads failed:', err.message);
    const notConfigured = err.message === 'storage_not_configured';
    res.status(notConfigured ? 503 : 500).json({ error: notConfigured ? 'storage_not_configured' : 'Server error' });
  }
};
