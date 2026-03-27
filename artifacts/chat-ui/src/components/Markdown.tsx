import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none",
        "prose-p:my-1.5 prose-p:leading-relaxed",
        "prose-headings:font-semibold prose-headings:my-2",
        "prose-h1:text-base prose-h2:text-sm prose-h3:text-sm",
        "prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4",
        "prose-li:my-0.5",
        "prose-code:bg-gray-800 prose-code:text-gray-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-gray-800 prose-pre:border prose-pre:border-gray-700 prose-pre:rounded-lg prose-pre:p-3 prose-pre:overflow-x-auto",
        "prose-pre:text-xs prose-pre:my-2",
        "prose-blockquote:border-l-2 prose-blockquote:border-gray-600 prose-blockquote:pl-3 prose-blockquote:text-gray-400 prose-blockquote:not-italic",
        "prose-strong:text-gray-100 prose-strong:font-semibold",
        "prose-em:text-gray-300",
        "prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline",
        "prose-hr:border-gray-700",
        "prose-table:text-xs prose-th:border prose-th:border-gray-700 prose-th:p-2 prose-td:border prose-td:border-gray-700 prose-td:p-2",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children, ...props }) {
            return (
              <pre
                {...props}
                className="not-prose bg-gray-800 border border-gray-700 rounded-lg p-3 overflow-x-auto my-2"
              >
                {children}
              </pre>
            );
          },
          code({ className, children, ...props }) {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <code className="text-xs font-mono text-gray-200" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="bg-gray-800 text-gray-200 px-1 py-0.5 rounded text-xs font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
