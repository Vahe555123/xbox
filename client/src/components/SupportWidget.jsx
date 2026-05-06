import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSupportLinks } from '../services/api';

const CONTACT_ITEMS = [
  { key: 'vkUrl', id: 'vk', label: 'ВКонтакте' },
  { key: 'telegramUrl', id: 'telegram', label: 'Telegram' },
  { key: 'maxUrl', id: 'max', label: 'MAX' },
];

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3c5.523 0 10 3.806 10 8.5S17.523 20 12 20c-1.168 0-2.29-.17-3.335-.483L4 21l1.335-3.115C3.875 16.37 2 14.077 2 11.5 2 6.806 6.477 3 12 3Zm-4.5 7.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
      />
    </svg>
  );
}

function ServiceIcon({ id }) {
  if (id === 'telegram') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M21.944 4.661c.333-1.56-1.172-2.807-2.63-2.194L3.79 8.953c-1.67.7-1.57 3.107.154 3.665l3.207 1.04 1.24 4.113c.45 1.49 2.36 1.945 3.438.818l1.793-1.873 3.517 2.575c1.244.91 3.01.22 3.31-1.292l1.495-13.338ZM9.4 12.82l7.784-5.14-6.044 6.472a1 1 0 0 0-.251.48l-.46 2.119-.788-2.612a1 1 0 0 0-.241-.423Z"
        />
      </svg>
    );
  }

  if (id === 'vk') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12.785 17.43c-5.57 0-8.746-3.818-8.878-10.167h2.79c.092 4.658 2.144 6.633 3.77 7.04V7.263h2.63v4.017c1.607-.173 3.297-2.006 3.867-4.017h2.63c-.438 2.478-2.272 4.311-3.574 5.065 1.302.61 3.385 2.209 4.18 5.102h-2.894c-.622-1.92-2.168-3.42-4.209-3.624v3.624h-.312Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 5.75A2.75 2.75 0 0 1 8.75 3h6.5A2.75 2.75 0 0 1 18 5.75v12.5A2.75 2.75 0 0 1 15.25 21h-6.5A2.75 2.75 0 0 1 6 18.25V5.75Zm3 1.75a.75.75 0 0 0-.75.75v7.5c0 .414.336.75.75.75h6a.75.75 0 0 0 .75-.75v-7.5a.75.75 0 0 0-.75-.75H9Zm1.25 10.75a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm3.5 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z"
      />
    </svg>
  );
}

export default function SupportWidget() {
  const [links, setLinks] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadLinks = async () => {
      try {
        const nextLinks = await fetchSupportLinks();
        if (mounted) {
          setLinks(nextLinks || {});
        }
      } catch (_err) {
        if (mounted) {
          setLinks({});
        }
      }
    };

    const handleLinksChanged = () => {
      loadLinks();
    };

    loadLinks();
    window.addEventListener('support-links-changed', handleLinksChanged);

    return () => {
      mounted = false;
      window.removeEventListener('support-links-changed', handleLinksChanged);
    };
  }, []);

  const availableLinks = useMemo(() => {
    return CONTACT_ITEMS.filter((item) => {
      const value = links?.[item.key];
      return typeof value === 'string' && value.trim();
    });
  }, [links]);

  useEffect(() => {
    if (!availableLinks.length) {
      setOpen(false);
    }
  }, [availableLinks]);

  if (!links || !availableLinks.length) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="support-widget-trigger"
        onClick={() => setOpen(true)}
        aria-label="Открыть контакты поддержки"
      >
        <MessageIcon />
        <span>Помощь</span>
      </button>

      {open && (
        <div
          className="support-modal-backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="support-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-modal-title"
          >
            <button
              type="button"
              className="support-modal-close"
              aria-label="Закрыть"
              onClick={() => setOpen(false)}
            >
              x
            </button>

            <div className="support-modal-kicker">Поддержка</div>
            <h3 id="support-modal-title">Написать напрямую</h3>
            <p>Выберите удобный мессенджер и откройте личный диалог.</p>

            <div className="support-modal-actions">
              {availableLinks.map((item) => (
                <a
                  key={item.id}
                  className={`support-link-button support-link-button--${item.id}`}
                  href={links[item.key]}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ServiceIcon id={item.id} />
                  <span>{item.label}</span>
                </a>
              ))}
            </div>

            <Link className="support-modal-help-link" to="/help" onClick={() => setOpen(false)}>
              Открыть раздел помощи
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
