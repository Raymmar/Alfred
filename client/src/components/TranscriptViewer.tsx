import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  isChapter?: boolean;
  isNewParagraph?: boolean;
  confidence?: number;
}

interface TranscriptViewerProps {
  transcript: string;
  onSegmentClick: (start: number, end: number) => void;
  currentTime: number;
  className?: string;
}

export function TranscriptViewer({
  transcript,
  onSegmentClick,
  currentTime,
  className
}: TranscriptViewerProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);

  useEffect(() => {
    if (!transcript?.trim()) {
      console.log('Empty transcript received');
      return;
    }

    try {
      // More forgiving regex that captures both chapter headers and regular text and speaker
      const timestampRegex = /(?:(?:^|\n)#\s*([^\[]+))?\s*\[(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\]\s*(?:\<([^>]+)\>\s*)?((?:(?!\n#|\[\d{2}:\d{2}:\d{2})[\s\S])*)/gm;
      const parsedSegments: TranscriptSegment[] = [];
      let lastTimestamp = 0;

      // First pass: collect all matches
      const matches = Array.from(transcript.matchAll(timestampRegex));

      if (matches.length === 0) {
        // Fallback: Split by lines and create basic segments
        console.log('No timestamp matches found, using fallback parsing');
        const lines = transcript.split('\n');
        let currentSegment = '';

        lines.forEach((line, index) => {
          if (line.trim()) {
            if (line.startsWith('#')) {
              // If we have accumulated text, add it as a segment
              if (currentSegment) {
                parsedSegments.push({
                  text: currentSegment.trim(),
                  start: lastTimestamp,
                  end: lastTimestamp + 5,
                  isNewParagraph: true
                });
                lastTimestamp += 5;
              }
              // Add chapter header
              parsedSegments.push({
                text: line.replace('#', '').trim(),
                start: lastTimestamp,
                end: lastTimestamp + 5,
                isChapter: true
              });
              lastTimestamp += 5;
              currentSegment = '';
            } else {
              currentSegment += (currentSegment ? '\n' : '') + line;
            }
          }
        });

        // Add any remaining text
        if (currentSegment) {
          parsedSegments.push({
            text: currentSegment.trim(),
            start: lastTimestamp,
            end: lastTimestamp + 5,
            isNewParagraph: true
          });
        }
      } else {
        // Process matched segments
        matches.forEach((match, index) => {
          const [, chapterTitle, hours, minutes, seconds, milliseconds, speaker, text] = match;
          const startTime = parseInt(hours) * 3600 +
            parseInt(minutes) * 60 +
            parseInt(seconds) +
            (milliseconds ? parseInt(milliseconds) / 1000 : 0);

          // Calculate end time based on next segment or default duration
          const endTime = index < matches.length - 1
            ? calculateTimeFromMatch(matches[index + 1])
            : startTime + 5;

          if (chapterTitle?.trim()) {
            parsedSegments.push({
              text: chapterTitle.trim(),
              start: startTime,
              end: endTime,
              isChapter: true
            });
          }

          if (text?.trim()) {
            // Split text into paragraphs and preserve them
            const paragraphs = text.trim().split(/\n+/);
            paragraphs.forEach((paragraph, pIndex) => {
              if (paragraph.trim()) {
                parsedSegments.push({
                  text: paragraph.trim(),
                  start: startTime + (pIndex * 0.001), // Slight offset to maintain order
                  end: endTime,
                  speaker: speaker?.trim(),
                  isNewParagraph: pIndex > 0
                });
              }
            });
          }
        });
      }

      console.log(`Parsed ${parsedSegments.length} transcript segments`);
      if (parsedSegments.length === 0) {
        console.warn('No segments parsed, falling back to raw text');
        // Final fallback: just show the raw text
        parsedSegments.push({
          text: transcript,
          start: 0,
          end: 5,
          isNewParagraph: false
        });
      }

      setSegments(parsedSegments);
    } catch (error) {
      console.error('Error parsing transcript:', error);
      // Fallback to raw text while preserving basic structure
      const fallbackSegments = transcript
        .split('\n')
        .filter(line => line.trim())
        .map((line, index) => ({
          text: line.trim(),
          start: index * 5,
          end: (index + 1) * 5,
          isChapter: line.startsWith('#'),
          isNewParagraph: line.startsWith('#') || index > 0
        }));

      setSegments(fallbackSegments);
    }
  }, [transcript]);

  // Helper function to calculate timestamp from regex match
  const calculateTimeFromMatch = (match: RegExpMatchArray): number => {
    const [, , hours, minutes, seconds, milliseconds] = match;
    return parseInt(hours) * 3600 +
      parseInt(minutes) * 60 +
      parseInt(seconds) +
      (milliseconds ? parseInt(milliseconds) / 1000 : 0);
  };

  return (
    <div className={cn("h-full flex flex-col min-h-0", className)}>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-2">
          {segments.length > 0 ? (
            segments.map((segment, index) => (
              <div
                key={index}
                onClick={() => onSegmentClick(segment.start, segment.end)}
                className={cn(
                  "transition-colors",
                  segment.isChapter ? "mt-6 mb-2" : "my-1",
                  segment.isNewParagraph ? "mt-4" : "",
                  "hover:bg-muted rounded cursor-pointer p-2"
                )}
              >
                {segment.isChapter ? (
                  <h2 className="text-lg font-semibold">
                    {segment.text}
                  </h2>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        [{Math.floor(segment.start / 3600).toString().padStart(2, '0')}:
                        {Math.floor((segment.start % 3600) / 60).toString().padStart(2, '0')}:
                        {Math.floor(segment.start % 60).toString().padStart(2, '0')}]
                      </span>
                      {segment.speaker && (
                        <span className="text-xs font-medium px-2 py-0.5 bg-primary/10 rounded-full">
                          {segment.speaker}
                        </span>
                      )}
                    </div>
                    <p className="text-lg leading-relaxed font-sans">
                      {segment.text}
                    </p>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="p-4 text-muted-foreground">
              No transcript content available
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}