import React from 'react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  description?: string;
  confirmButtonLabel?: string;
  cancelButtonLabel?: string;
  isDangerous?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  description,
  confirmButtonLabel = 'Confirm',
  cancelButtonLabel = 'Cancel',
  isDangerous = false,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      await onConfirm();
    } catch (error) {
      console.error('Confirmation action failed:', error);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="modal-eyebrow">{isDangerous ? '⚠ Warning' : 'Confirm Action'}</p>
            <h2 id="confirmation-title">{title}</h2>
          </div>
          <button
            className="modal-close"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <div className="confirmation-content">
          <p className="confirmation-message">{message}</p>
          {description && <p className="confirmation-description">{description}</p>}
        </div>

        <div className="modal-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelButtonLabel}
          </button>
          <button
            className={`primary-button ${isDangerous ? 'danger' : ''}`}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
