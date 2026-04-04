import { BrowserRouter, Routes, Route } from "react-router-dom";
import './App.css';
import Home from './Home.jsx';
import Docs from './docs/Docs.jsx'
import NoPage from './NoPage.jsx';
import Header from './header/Header.jsx';
import IconPack from './icon-pack/IconPack.jsx';
function App() {
  return (
    <BrowserRouter>
      <Routes>
          <Route path="/gfx_web/" element={<Home />} />
          <Route path="/gfx_web/index.html" element={<Home />} />
          <Route path="/gfx_web/docs/" element={<Docs />} />
          <Route path="/gfx_web/docs/index.html" element={<Docs />} />
          <Route path="/gfx_web/header/" element={<Header />} />
          <Route path="/gfx_web/header/index.html" element={<Header />} />
          <Route path="/gfx_web/icon-pack/" element={<IconPack />} />
          <Route path="/gfx_web/icon-pack/index.html" element={<IconPack />} />
          <Route path="*" element={<NoPage />} />
        
      </Routes>
    </BrowserRouter>
  );
}

export default App;
