'use client'

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

export default function CustomSelect({ 
  options, 
  value, 
  onChange, 
  label, 
  placeholder = 'Seleccionar...',
  className = ''
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`custom-select-container ${className}`} ref={containerRef}>
      {label && <label className="select-label">{label}</label>}
      
      <div 
        className={`select-trigger ${isOpen ? 'active' : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="selected-value">
          {selectedOption ? (
            <div className="option-content">
              {selectedOption.icon && <span className="option-icon">{selectedOption.icon}</span>}
              <span>{selectedOption.label}</span>
            </div>
          ) : (
            <span className="placeholder">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={18} className={`chevron ${isOpen ? 'rotate' : ''}`} />
      </div>

      {isOpen && (
        <div className="select-dropdown animate-pop-in">
          {options.map((option) => (
            <div 
              key={option.value}
              className={`select-option ${value === option.value ? 'selected' : ''}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              <div className="option-content">
                {option.icon && <span className="option-icon">{option.icon}</span>}
                <span>{option.label}</span>
              </div>
              {value === option.value && <Check size={16} className="check-icon" />}
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .custom-select-container {
          position: relative;
          width: 100%;
          font-family: 'Inter', sans-serif;
        }

        .select-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          margin-bottom: 6px;
          letter-spacing: 0.025em;
        }

        .select-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          min-height: 44px;
        }

        .select-trigger:hover {
          border-color: #6366f1;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }

        .select-trigger.active {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        .selected-value {
          font-size: 0.95rem;
          color: #1e293b;
          font-weight: 500;
        }

        .placeholder {
          color: #94a3b8;
        }

        .option-content {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .option-icon {
          display: flex;
          align-items: center;
          color: #6366f1;
        }

        .chevron {
          color: #94a3b8;
          transition: transform 0.2s ease;
        }

        .chevron.rotate {
          transform: rotate(180deg);
        }

        .select-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          z-index: 1000;
          overflow: hidden;
          padding: 6px;
        }

        .select-option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.15s ease;
          font-size: 0.9rem;
          color: #475569;
        }

        .select-option:hover {
          background: #f5f3ff;
          color: #6366f1;
        }

        .select-option.selected {
          background: #f5f3ff;
          color: #6366f1;
          font-weight: 600;
        }

        .check-icon {
          color: #6366f1;
        }

        .animate-pop-in {
          animation: popIn 0.2s cubic-bezier(0, 0, 0.2, 1);
        }

        @keyframes popIn {
          from { opacity: 0; transform: scale(0.95) translateY(-10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
