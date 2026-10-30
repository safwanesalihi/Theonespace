'use client';
// Blur Text — after React Bits (https://reactbits.dev/text-animations/blur-text) by David Haz, MIT + Commons
// Clause. Pared down for the hero's headline: the words come out of a blur one after another, once, as the
// page opens. Words only, never letters, so Arabic keeps its joined shapes; screen readers get the whole
// sentence at once. With reduced motion the words fade in without travelling (MotionConfig "user").
import { MotionConfig, motion } from 'motion/react';
import { ease } from '@/lib/motion';

const hidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

export default function BlurText({ text, delay = 0, step = 0.09, duration = 0.8 }: { text: string; delay?: number; step?: number; duration?: number }) {
  const words = text.split(' ');
  return (
    <MotionConfig reducedMotion="user">
      <span style={hidden}>{text}</span>
      {words.map((word, i) => (
        <span key={`${i}-${word}`} aria-hidden="true">
          {i > 0 && ' '}
          <motion.span
            style={{ display: 'inline-block', willChange: 'transform, filter, opacity' }}
            initial={{ opacity: 0, filter: 'blur(14px)', y: '0.32em' }}
            animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
            transition={{ duration, delay: delay + i * step, ease: ease.arrive }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </MotionConfig>
  );
}
