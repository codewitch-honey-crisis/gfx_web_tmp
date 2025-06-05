import { BrowserRouter, Routes, Route } from "react-router-dom";
import './App.css';
import Layout from './Layout.jsx'
import Home from './Home.jsx';
import NoPage from './NoPage.jsx';
import Header from './header/Header.jsx';
import IconPack from './icon-pack/IconPack.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        
          <Route path="/" element={<Home />} />
          <Route path="header/" element={<Header />} />
          <Route path="header/index.html" element={<Header />} />
          <Route path="icon-pack/" element={<IconPack />} />
          <Route path="icon-pack/index.html" element={<IconPack />} />
          <Route path="*" element={<NoPage />} />
        
      </Routes>
    </BrowserRouter>
  );
}

export default App;
