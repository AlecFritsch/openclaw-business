'use client';

import type { Step } from 'nextstepjs';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Props {
  step: Step;
  currentStep: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  arrow: React.ReactNode;
}

export default function TourCard({ step, currentStep, totalSteps, nextStep, prevStep, skipTour, arrow }: Props) {
  const isLast = currentStep === totalSteps - 1;
  return (
    <div className="card w-[320px] p-0 shadow-lg">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <Image src="https://ucarecdn.com/df601530-a09a-4c18-b5e4-ed8072cfdf24/logo_transparent_dunkel.png" alt="" width={18} height={18} className="h-[18px] w-auto dark:hidden" />
            <Image src="https://ucarecdn.com/f9188e54-9da2-49b4-a1c7-9ebe496c7060/logo_transparent_weiss.png" alt="" width={18} height={18} className="h-[18px] w-auto hidden dark:block" />
            <h3 className="text-sm font-medium">{step.title}</h3>
          </div>
          <button onClick={skipTour} className="text-muted-foreground hover:text-foreground transition-colors -mt-0.5 -mr-1 p-1 rounded-lg hover:bg-muted">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed">{step.content}</div>
      </div>
      {arrow}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border">
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{currentStep + 1} / {totalSteps}</span>
        <div className="flex items-center gap-1.5">
          {currentStep > 0 && (
            <button onClick={prevStep} className="btn-ghost-sm flex items-center"><ChevronLeft className="w-3 h-3" /></button>
          )}
          <button onClick={nextStep} className="btn-primary-sm flex items-center gap-1">
            {isLast ? 'Los geht\'s' : 'Weiter'}
            {!isLast && <ChevronRight className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
