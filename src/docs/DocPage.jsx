import React, { useMemo, useState, useRef, useEffect, Suspense } from 'react';
import MarkdownHooks from 'react-markdown';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp';

const DocPage = () => {
    const [content, setContent] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(document.location.search);
    let path;
    path = params.get("path");
    
    if(path==="" || path===null || path===undefined) {
        console.log("path unset");
        path = "https://raw.githubusercontent.com/codewitch-honey-crisis/gfx/refs/heads/master/docs/index.md";
    } else {
        path = `https://raw.githubusercontent.com/codewitch-honey-crisis/gfx/refs/heads/master/docs/${path.replace("%23","#")}`;
    }
    fetch(path)
      .then(res => res.text())
      .then(setContent)
  }, [])

  if (!content) return <div>Loading...</div>

  return (
  <MarkdownHooks
    components={{
      a(props) {
        const { node, href, ...rest } = props
        if(props.href !== undefined) {
            return <a href={'?path=' + href.replace('#','%23')} {...rest} />
        }
      },
      code(props) {
        const {children, className, node, ...rest} = props
        const match = /language-(\w+)/.exec(className || '')
        return match ? (
          <SyntaxHighlighter
            {...rest}
            PreTag="div"
            children={String(children).replace(/\n$/, '')}
            language={match[1]}
            style={dark}
          />
        ) : (
          <code {...rest} className={className}>
            {children}
          </code>
        )
      }
    }}
  >
    {content}
  </MarkdownHooks>
)
}
export default DocPage;