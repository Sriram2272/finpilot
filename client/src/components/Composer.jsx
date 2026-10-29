import { useEffect, useRef, useState } from 'react';
import { imageToDataUrl } from '../api';

const EXAMPLES = ['Lunch ₹450 at Barbeque Nation yesterday, card', 'Uber to office 230 today via GPay', 'Salary of 85k credited on 1st Oct'];

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function Composer({ busy, onSubmit, onReceipt, aiAvailable }) {
  const [note, setNote] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState('');
  const recRef = useRef(null);
  const baseRef = useRef('');
  const fileRef = useRef(null);
  const [preview, setPreview] = useState('');

  useEffect(() => () => recRef.current?.abort(), []);

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
    <form className="panel composer" onSubmit={submit}>
      <label htmlFor="note" className="panel-title">
        New entry
      </label>
      <div className={`command ${listening ? 'live' : ''}`}>
        <textarea
          id="note"
          rows={2}
          maxLength={600}
          value={note}
          placeholder="Describe a payment, e.g. “Paid ₹320 for dinner at Meghana’s yesterday with GPay”"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        <div className="command-bar">
          <div className="command-tools">
            {SpeechRecognition && (
              <button type="button" className={`icon-btn ${listening ? 'rec' : ''}`} onClick={toggleMic} disabled={busy} title={listening ? 'Stop listening' : 'Speak'} aria-label={listening ? 'Stop listening' : 'Speak'}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => fileRef.current?.click()}
              disabled={busy || !aiAvailable}
              title={aiAvailable ? 'Scan a receipt' : 'Receipt scanning needs Claude on the server'}
              aria-label="Scan a receipt"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickReceipt} />
            {listening && <span className="live-label">Listening…</span>}
          </div>
          <button type="submit" className="btn primary" disabled={!note.trim() || busy}>
            {busy ? 'Reading…' : 'Continue'}
            {!busy && <kbd>↵</kbd>}
          </button>
        </div>
      </div>
      {micError && <p className="hint warn">{micError}</p>}
      {busy && preview && (
        <div className="receipt-busy">
          <img src={preview} alt="Receipt being read" />
          <span className="muted">Reading your receipt…</span>
        </div>
      )}
      {!note && !busy && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} className="example" onClick={() => setNote(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
