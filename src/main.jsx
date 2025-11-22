import React from 'react'
import ReactDOM from 'react-dom/client'
import MMSIAssignmentSystem from './MaritimeManager.jsx'
import './index.css'

// Simple default styles to ensure full height
const style = document.createElement('style');
style.innerHTML = `
  html, body, #root {
    height: 100%;
    margin: 0;
    padding: 0;
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MMSIAssignmentSystem />
  </React.StrictMode>,
)