import { useState, useEffect } from 'react';
import { createZohoLead } from '../services/zohoApi';
import { sendEmail } from '../services/emailService';

export default function SendingModal({ contact, isOffline, onComplete }) {
  const [waProgress, setWaProgress] = useState(0);
  const [emailProgress, setEmailProgress] = useState(0);
  const [zohoProgress, setZohoProgress] = useState(0);
  
  const [waStatus, setWaStatus] = useState('sending');
  const [emailStatus, setEmailStatus] = useState('sending');
  const [zohoStatus, setZohoStatus] = useState('sending');
  const [zohoLeadId, setZohoLeadId] = useState(null);
  
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    let active = true;

    const runWorkflows = async () => {
      if (isOffline) {
        setWaProgress(100);
        setWaStatus('queued');
        setEmailProgress(100);
        setEmailStatus('queued');
        setZohoProgress(100);
        setZohoStatus('queued');
        setAllDone(true);
        return;
      }

      // Online: Run real Zoho CRM sync first
      setZohoProgress(10);
      let zohoInterval;
      try {
        let leadId = null;
        if (contact && contact.zohoLeadId) {
          console.log('✓ Zoho Lead ID already exists, skipping API call');
          leadId = contact.zohoLeadId;
        } else {
          zohoInterval = setInterval(() => {
            setZohoProgress(prev => Math.min(prev + 10, 90));
          }, 100);
          
          const res = await createZohoLead(contact);
          clearInterval(zohoInterval);
          leadId = res.zohoLeadId;
        }

        if (!active) return;
        setZohoProgress(100);
        setZohoStatus('synced');
        setZohoLeadId(leadId);

        // Next: EmailJS send
        setEmailProgress(10);
        const emailProgressInterval = setInterval(() => {
          setEmailProgress(prev => Math.min(prev + 10, 90));
        }, 100);

        const emailResult = await sendEmail(contact, contact.emailMessage);
        clearInterval(emailProgressInterval);

        if (!active) return;
        setEmailProgress(100);
        if (emailResult.success) {
          setEmailStatus('sent');
        } else {
          setEmailStatus('failed');
        }

        // WhatsApp simulation
        setWaProgress(10);
        const waProgressInterval = setInterval(() => {
          setWaProgress(prev => Math.min(prev + 15, 90));
        }, 100);
        await new Promise(r => setTimeout(r, 600));
        clearInterval(waProgressInterval);

        if (!active) return;
        setWaProgress(100);
        setWaStatus('sent');
        setAllDone(true);

      } catch (err) {
        console.error('Workflow failed at Zoho CRM Sync:', err);
        if (zohoInterval) clearInterval(zohoInterval);
        if (!active) return;
        setZohoProgress(100);
        setZohoStatus('failed');
        setEmailProgress(0);
        setEmailStatus('failed');
        setWaProgress(0);
        setWaStatus('failed');
        setAllDone(true);
      }
    };

    runWorkflows();

    return () => {
      active = false;
    };
  }, [isOffline, contact]);

  const StatusRow = ({ label, icon, color, progress, status }) => {
    const isSending = status === 'sending';
    const isSent = status === 'sent' || status === 'synced';
    const isQueued = status === 'queued';
    const isFailed = status === 'failed';

    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}>
            <span className="material-icons" style={{ color }}>{icon}</span>
            {label}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: isFailed ? 'var(--danger)' : 'inherit' }}>
            {isSending ? `${progress}%` : isSent ? (status === 'synced' ? 'SYNCED' : 'DELIVERED') : isFailed ? 'FAILED' : 'QUEUED'}
          </div>
        </div>
        <div style={{ height: 6, background: 'var(--background)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ 
            height: '100%', 
            width: `${progress}%`, 
            background: isQueued ? 'var(--warning)' : isFailed ? 'var(--danger)' : color, 
            transition: 'width 0.3s ease',
            borderRadius: 10
          }} />
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 24 }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 48, height: 48, borderWidth: 4 }} />
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{allDone ? 'Success!' : 'Processing Dispatches'}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{allDone ? 'Your dispatches are updated.' : 'Please wait while we process the dispatch.'}</p>
        </div>

        <div style={{ textAlign: 'left', marginBottom: 24 }}>
          <StatusRow label="WhatsApp" icon="chat" color="#16A34A" progress={waProgress} status={waStatus} />
          <StatusRow label="Email" icon="email" color="var(--primary)" progress={emailProgress} status={emailStatus} />
          <StatusRow label="Zoho CRM Sync" icon="cloud_sync" color="#EA580C" progress={zohoProgress} status={zohoStatus} />
        </div>

        {allDone && (
          <button className="btn btn-primary btn-full status-sent" onClick={() => onComplete(waStatus, emailStatus, zohoStatus, zohoLeadId)}>
            Continue to Contacts
          </button>
        )}
      </div>
    </div>
  );
}
