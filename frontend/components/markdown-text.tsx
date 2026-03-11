"use client";

import React, { useState } from "react";

interface MarkdownTextProps {
  content: string;
  className?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="text-xs uppercase tracking-wider text-muted-foreground hover:text-gray-600 dark:hover:text-muted-foreground rounded transition-colors px-1.5 py-0.5"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function MarkdownText({ content, className = "" }: MarkdownTextProps) {
  const renderMarkdown = (text: string): React.ReactNode[] => {
    const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();
    const lines = cleaned.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 my-2">
            {listItems.map((item, i) => (
              <li key={i} className="text-sm">{renderInline(item)}</li>
            ))}
          </ul>
        );
        listItems = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^[-*\u2022]\s+/.test(line)) {
        listItems.push(line.replace(/^[-*\u2022]\s+/, ''));
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        listItems.push(line.replace(/^\d+\.\s+/, ''));
        continue;
      }

      flushList();

      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        elements.push(<hr key={`hr-${i}`} className="border-border my-3" />);
        continue;
      }

      if (line.trim() === '') {
        const lastEl = elements[elements.length - 1];
        const lastKey = lastEl && typeof lastEl === 'object' && 'key' in lastEl ? String(lastEl.key) : '';
        if (!lastKey.startsWith('br-')) {
          elements.push(<br key={`br-${i}`} />);
        }
        continue;
      }

      if (line.startsWith('### ')) {
        elements.push(<h4 key={`h4-${i}`} className="font-medium text-sm mt-3 mb-1">{renderInline(line.slice(4))}</h4>);
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(<h3 key={`h3-${i}`} className="font-medium mt-3 mb-1">{renderInline(line.slice(3))}</h3>);
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(<h2 key={`h2-${i}`} className="font-medium text-lg mt-3 mb-1">{renderInline(line.slice(2))}</h2>);
        continue;
      }

      // Table support: detect | col | col | rows
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableRows: string[][] = [];
        let j = i;
        while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
          const cells = lines[j].trim().slice(1, -1).split('|').map(c => c.trim());
          // Skip separator rows (|---|---|)
          if (!cells.every(c => /^[-:]+$/.test(c))) {
            tableRows.push(cells);
          }
          j++;
        }
        if (tableRows.length > 0) {
          const [header, ...body] = tableRows;
          elements.push(
            <div key={`table-${i}`} className="my-3 overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    {header.map((cell, ci) => (
                      <th key={ci} className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{renderInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 1 ? 'bg-gray-50/50 dark:bg-background/50' : ''}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-1.5 text-gray-700 dark:text-muted-foreground border-t border-border/60">{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          i = j - 1;
          continue;
        }
      }

      if (line.startsWith('```')) {
        const codeLines: string[] = [];
        const lang = line.slice(3).trim();
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (lang !== 'config' && lang !== 'suggestions') {
          const codeText = codeLines.join('\n');
          elements.push(
            <div key={`code-${i}`} className="my-2 border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1 bg-muted border-b border-border">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  {lang || "code"}
                </span>
                <CopyButton text={codeText} />
              </div>
              <pre className="px-3 py-2.5 overflow-x-auto">
                <code className="text-xs font-mono text-gray-700 dark:text-muted-foreground">{codeText}</code>
              </pre>
            </div>
          );
        }
        continue;
      }

      elements.push(<p key={`p-${i}`} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }

    flushList();
    return elements;
  };

  const renderInline = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/^([\s\S]*?)\*\*(.+?)\*\*([\s\S]*)/);
      if (boldMatch) {
        if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
        parts.push(<strong key={key++} className="font-semibold">{boldMatch[2]}</strong>);
        remaining = boldMatch[3];
        continue;
      }

      const italicMatch = remaining.match(/^([\s\S]*?)\*(.+?)\*([\s\S]*)/);
      if (italicMatch) {
        if (italicMatch[1]) parts.push(<span key={key++}>{italicMatch[1]}</span>);
        parts.push(<em key={key++}>{italicMatch[2]}</em>);
        remaining = italicMatch[3];
        continue;
      }

      const codeMatch = remaining.match(/^([\s\S]*?)`(.+?)`([\s\S]*)/);
      if (codeMatch) {
        if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
        parts.push(
          <code key={key++} className="px-1.5 py-0.5 bg-muted border border-border rounded-lg text-xs font-mono">
            {codeMatch[2]}
          </code>
        );
        remaining = codeMatch[3];
        continue;
      }

      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  return <div className={`space-y-1 ${className}`}>{renderMarkdown(content)}</div>;
}
