import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Conversation } from '../settings/components/Conversation';
import './style.css';
function App() {
  const [state, setState] = useState<any>();
  useEffect(() => { const refresh = () => { void window.teammateApi.call('status').then(setState); }; refresh(); return window.teammateApi.onChange(refresh); }, []);
  return state ? <Conversation state={state} zh={state.language.startsWith('zh')} floating /> : null;
}
createRoot(document.getElementById('root')!).render(<App />);
