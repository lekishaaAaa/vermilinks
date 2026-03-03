import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useDarkMode } from '../contexts/DarkModeContext';

const DarkModeToggle: React.FC = () => {
  const { isDarkMode, toggleDarkMode } = useDarkMode();

  return (
    <button
      onClick={toggleDarkMode}
      className="relative cursor-pointer p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors duration-200"
      aria-label="Toggle dark mode"
    >
      <div className="relative w-6 h-6">
        <Sun 
          className={`absolute inset-0 h-6 w-6 text-yellow-500 transition-transform duration-300 ${
            isDarkMode ? 'rotate-90 scale-0' : 'rotate-0 scale-100'
          }`}
        />
        <Moon 
          className={`absolute inset-0 h-6 w-6 text-blue-400 transition-transform duration-300 ${
            isDarkMode ? 'rotate-0 scale-100' : '-rotate-90 scale-0'
          }`}
        />
      </div>
    </button>
  );
};

export default DarkModeToggle;
