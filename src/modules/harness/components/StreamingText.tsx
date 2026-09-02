import React from "react";

type StreamingTextProps = {
  text: string;
  isStreaming: boolean;
};

export const StreamingText: React.FC<StreamingTextProps> = ({
  text,
  isStreaming,
}) => {
  return (
    <div className="relative inline font-sans text-sm leading-relaxed whitespace-pre-wrap select-text">
      <span>{text}</span>
      {isStreaming && (
        <span
          className="inline-block w-1.5 h-4 ml-0.5 bg-gradient-to-b from-blue-400 to-violet-400 animate-pulse align-middle rounded-sm shadow-[0_0_8px_rgba(96,165,250,0.8)]"
          aria-hidden="true"
        />
      )}
    </div>
  );
};
