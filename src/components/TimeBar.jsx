
import React, { useState, useEffect } from 'react';

const TimeBar = ({ targetDate = '2026-11-09T23:59:59Z' }) => {
  const [time, setTime] = useState(new Date());
  const [countdown, setCountdown] = useState('');
  const [weather, setWeather] = useState({ temp: '--', cond: 'Loading...' });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTime(now);
      const diff = new Date(targetDate) - now;
      if (diff <= 0) setCountdown('EVENT STARTED');
      else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const mins = Math.floor((diff / 1000 / 60) % 60);
        const secs = Math.floor((diff / 1000) % 60);
        setCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
      }
    }, 1000);

    const updateWeather = async () => {
      setWeather({ temp: '28°C', cond: 'Sunny ☀️' });
    };
    updateWeather();

    return () => clearInterval(timer);
  }, [targetDate]);

  const formattedDate = time.toLocaleDateString('en-GB', { 
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', 
    timeZone: 'Africa/Nairobi' 
  });
  
  const formattedTime = time.toLocaleTimeString('en-GB', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit', 
    timeZone: 'Africa/Nairobi', hour12: false 
  });

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 12px',
      backgroundColor: '#0f172a',
      color: '#94a3b8',
      fontSize: '11px',
      fontFamily: 'monospace',
      borderBottom: '1px solid #1e293b',
      width: '100%',
      boxSizing: 'border-box'
    }}>
      <div style={{ display: 'flex', gap: '15px' }}>
        <span>📅 {formattedDate}</span>
        <span>🕒 {formattedTime} EAT</span>
        <span style={{ color: '#38bdf8' }}>🌡️ {weather.temp} {weather.cond}</span>
      </div>
      <div style={{ color: '#fbbf24', fontWeight: 'bold' }}>
        ⏳ Target: {countdown}
      </div>
    </div>
  );
};

export default TimeBar;
