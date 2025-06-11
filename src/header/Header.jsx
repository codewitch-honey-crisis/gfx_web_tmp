import '../App.css';
import { lazy, Suspense } from 'react';
const HeaderGenerator = lazy(() => import('../components/HeaderGenerator.jsx'));
function Header() {
    return (
        <>
            <h2>GFX header file generator</h2>
            <Suspense fallback={
                <center>
                    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
                        <circle fill='#FF156D' stroke='#FF156D' strokeWidth='15' r='15' cx='40' cy='65'>
                            <animate attributeName='cy' calcMode='spline' dur='2' values='65;135;65;' keySplines='.5 0 .5 1;.5 0 .5 1' repeatCount='indefinite' begin='-.4'></animate>
                        </circle>
                        <circle fill='#FF156D' stroke='#FF156D' strokeWidth='15' r='15' cx='100' cy='65'>
                            <animate attributeName='cy' calcMode='spline' dur='2' values='65;135;65;' keySplines='.5 0 .5 1;.5 0 .5 1' repeatCount='indefinite' begin='-.2'></animate>
                        </circle>
                        <circle fill='#FF156D' stroke='#FF156D' strokeWidth='15' r='15' cx='160' cy='65'>
                            <animate attributeName='cy' calcMode='spline' dur='2' values='65;135;65;' keySplines='.5 0 .5 1;.5 0 .5 1' repeatCount='indefinite' begin='0'></animate>
                        </circle>
                    </svg>
                </center>
            }>
                <HeaderGenerator />
            </Suspense>
            <center><a href="../index.html">GFX Home</a></center>
        </>
    );
}

export default Header;
