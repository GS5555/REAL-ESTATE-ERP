import { useEffect, useRef, useState } from 'react';

// Voice-based data entry using the Web Speech API (English + Indian languages).
// Fallback: manual entry. Works best in Chrome/Edge on desktop & mobile.
export function VoiceInput({ onText, lang = 'en-IN', placeholder = 'Tap mic and speak...', minLength = 6 }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      onText(text);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.abort(); } catch {} };
  }, [lang, onText]);

  if (!supported) {
    return <div className="small muted">Voice entry not supported in this browser — please type instead.</div>;
  }

  return (
    <button
      type="button"
      className={`btn ${listening ? 'danger' : 'primary'}`}
      onClick={() => {
        if (listening) { recRef.current?.stop(); setListening(false); return; }
        try { recRef.current?.start(); setListening(true); } catch { }
      }}
      title={placeholder}
    >
      {listening ? '⏺ Listening… (tap to stop)' : '🎤 Voice entry'}
    </button>
  );
}

// Text-to-speech readout (assistive / demo AI voice)
export function speak(text, lang = 'en-IN') {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}
