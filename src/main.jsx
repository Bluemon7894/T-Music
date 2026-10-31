import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import App from './App.jsx';
import { api } from './lib/api.js';
import { LANGUAGE } from './lib/i18n.js';
import './styles/index.css';

Promise.resolve(api.setLanguage(LANGUAGE)).catch(() => {});

createRoot(document.getElementById('root')).render(<App />);
