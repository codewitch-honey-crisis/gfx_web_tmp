import '../App.css';
import DocPage from './DocPage.jsx';
import './Docs.css';
import { lazy, Suspense } from 'react';

function Docs() {
    return (
        <>
            <a href="../index.html">&lt; GFX Home</a>
            <h2>GFX Documentation</h2>
            <DocPage />
        </>
    );
}

export default DocPage;
