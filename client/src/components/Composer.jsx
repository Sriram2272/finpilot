import { useEffect, useRef, useState } from 'react';
import { imageToDataUrl } from '../api';

const EXAMPLES = [
  'Spent ₹450 on lunch at Barbeque Nation yesterday, paid by card',
  'Uber to office 230 today via GPay',
  'Salary of 85k credited on 1st Oct',
  'Coffee at Starbucks',
];

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function Composer({ busy, onSubmit, onReceipt, aiAvailable }) {
  const [note, setNote] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState('');
  const recRef = useRef(null);
  const baseRef = useRef('');
  const fileRef = useRef(null);
  const [preview, setPreview] = useState('');

  async function pickReceipt(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMicError('');
    try {
      const dataUrl = await imageToDataUrl(file);
      setPreview(dataUrl);
      onReceipt(dataUrl);
    } catch {
      setMicError("Couldn't read that image. Try a JPEG or PNG photo.");
    }
  }

  useEffect(() => () => recRef.current?.abort(), []);

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    setMicError('');
    const rec = new SpeechRecognition();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = false;
    baseRef.current = note ? `${note.trim()} ` : '';
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join('');
      setNote(baseRef.current + said);
    };
    rec.onerror = (e) => {
      setMicError(e.error === 'not-allowed' ? 'Microphone access was blocked. You can type instead.' : "Didn't catch that — try again or type it.");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  function submit(e) {
    e.preventDefault();
    if (note.trim() && !busy) onSubmit(note.trim());
  }

  return (
    <form className="card composer" onSubmit={submit}>
      <label htmlFor="note" className="composer-label">
        What did you spend or receive?
      </label>
      <textarea
        id="note"
        rows={3}
        maxLength={600}
        value={note}
        placeholder="e.g. Paid ₹320 for dinner at Meghana's yesterday with GPay"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      <div className="composer-actions">
        {SpeechRecognition && (
          <button type="button" className={`btn ghost mic ${listening ? 'live' : ''}`} onClick={toggleMic} disabled={busy}>
            <span className="dot" aria-hidden="true" />
            {listening ? 'Listening… tap to stop' : 'Speak'}
          </button>
        )}
        <button
          type="button"
          className="btn ghost"
          onClick={() => fileRef.current?.click()}
          disabled={busy || !aiAvailable}
          title={aiAvailable ? 'Snap or upload a receipt; Claude reads it' : 'Receipt scanning needs Claude on the server'}
        >
          📷 Scan receipt
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickReceipt} />
        <span className="count">{note.length}/600</span>
        <button type="submit" className="btn primary" disabled={!note.trim() || busy}>
          {busy ? 'Reading…' : 'Read it'}
        </button>
      </div>
      {micError && <p className="hint warn">{micError}</p>}
      {busy && preview && (
        <div className="receipt-busy">
          <img src={preview} alt="Receipt being read" />
          <span className="muted">Claude is reading your receipt…</span>
        </div>
      )}
      <div className="examples">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button type="button" key={ex} className="chip" onClick={() => setNote(ex)} disabled={busy}>
            {ex}
          </button>
        ))}
      </div>
    </form>
  );
}
