import '../App.css';
import { lazy, Suspense } from 'react';
const HeaderGenerator = lazy(() => import('../components/HeaderGenerator.jsx'));
function Header() {
  return (
    <>
      <h2>GFX header file generator</h2>
        <Suspense fallback={<span>Loading...</span>}>
            <HeaderGenerator />
        </Suspense>
    </>
  );
}

export default Header;
