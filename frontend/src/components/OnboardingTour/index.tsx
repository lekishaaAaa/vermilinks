import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import introJs from 'intro.js/minified/intro.min.js';
import 'intro.js/minified/introjs.min.css';
// import './tour.css'; // Temporarily disabled for testing

type Step = {
  element?: string;
  intro: string;
  title?: string;
};

type Props = {
  steps: Step[];
  storageKey?: string;
};

const OnboardingTour: React.FC<Props> = ({ steps, storageKey = 'onboarding_seen' }) => {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname !== '/') {
      return;
    }

    let intro: any;
    let startTimer: ReturnType<typeof setTimeout> | null = null;

    // Add keyboard shortcut to manually start tour for testing
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 't') {
        event.preventDefault();
        console.log('Tour: Manual trigger activated');
        startTour();
      }
    };

    document.addEventListener('keydown', handleKeyPress);

    try {
      const seen = localStorage.getItem(storageKey);
      console.log('Tour: localStorage check for', storageKey, ':', seen);
      if (!seen) {
        console.log('Tour: Starting tour with steps:', steps);
        startTour();
      } else {
        console.log('Tour: Already seen, skipping');
      }
    } catch (e) {
      console.error('Tour: Error starting tour:', e);
    }

    function startTour() {
      try {
        intro = introJs();
        // map steps to intro.js format
        intro.setOptions({
          steps: steps.map(s => ({
            element: s.element || undefined,
            intro: s.intro,
            title: s.title,
          })),
          showProgress: true,
          showStepNumbers: true,
          exitOnOverlayClick: false,
          nextLabel: 'Next',
          prevLabel: 'Previous',
          skipLabel: 'Skip',
          doneLabel: 'Finish',
        });
        console.log('Tour: About to start intro.js');
        // Add a longer delay to ensure DOM is fully ready
        startTimer = setTimeout(() => {
          // Check if target elements exist before starting
          const navElement = document.querySelector('nav');
          const dashboardElement = document.querySelector('#dashboard-card');
          const adminElement = document.querySelector('#admin-access-btn');

          console.log('Tour: Checking elements exist:');
          console.log('  nav:', !!navElement);
          console.log('  dashboard-card:', !!dashboardElement);
          console.log('  admin-access-btn:', !!adminElement);

          if (navElement && dashboardElement && adminElement) {
            console.log('Tour: All elements found, starting intro.js');
            intro.start();
            console.log('Tour: Intro.js started successfully');
          } else {
            console.log('Tour: Some elements not found, skipping tour');
          }
        }, 2000);
        intro.oncomplete(() => {
          console.log('Tour: Completed');
          try { localStorage.setItem(storageKey, '1'); } catch (e) {}
        });
        intro.onexit(() => {
          console.log('Tour: Exited');
          try { localStorage.setItem(storageKey, '1'); } catch (e) {}
        });
      } catch (e) {
        console.error('Tour: Error in startTour:', e);
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      if (startTimer) {
        clearTimeout(startTimer);
      }
      try {
        if (intro && intro.exit) {
          console.log('Tour: Cleaning up intro instance');
          intro.exit();
        }
      } catch (e) {}
    };
  }, [steps, storageKey, location.pathname]);

  return null;
};

export default OnboardingTour;
