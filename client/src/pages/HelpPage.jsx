import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Spinner from '../components/Spinner';
import ErrorMessage from '../components/ErrorMessage';
import { fetchHelpContent, fetchSupportLinks } from '../services/api';

const CONTACT_META = {
  vkUrl: { label: 'ВКонтакте', icon: 'VK' },
  telegramUrl: { label: 'Telegram', icon: 'TG' },
  maxUrl: { label: 'MAX', icon: 'MX' },
};

function pickPrimarySupportUrl(content, links) {
  if (content?.supportButtonUrl) return content.supportButtonUrl;
  return links.telegramUrl || links.vkUrl || links.maxUrl || '';
}

export default function HelpPage() {
  const [content, setContent] = useState(null);
  const [links, setLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const [nextContent, nextLinks] = await Promise.all([
          fetchHelpContent(),
          fetchSupportLinks().catch(() => ({})),
        ]);

        if (cancelled) return;
        setContent(nextContent || {});
        setLinks(nextLinks || {});
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error?.message || err.message || 'Не удалось загрузить раздел помощи');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const contactLinks = useMemo(() => (
    Object.entries(CONTACT_META)
      .map(([key, meta]) => {
        const url = String(links?.[key] || '').trim();
        if (!url) return null;
        return { ...meta, key, url };
      })
      .filter(Boolean)
  ), [links]);

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;

  const primarySupportUrl = pickPrimarySupportUrl(content, links);
  const steps = Array.isArray(content?.steps) ? content.steps.filter((item) => item?.title || item?.body) : [];
  const faqItems = Array.isArray(content?.faqItems) ? content.faqItems.filter((item) => item?.question || item?.answer) : [];

  return (
    <div className="help-page">
      <section className="help-hero">
        {content?.eyebrow && <p className="help-kicker">{content.eyebrow}</p>}
        <h1>{content?.title || 'Помощь'}</h1>
        {content?.subtitle && <p className="help-hero-text">{content.subtitle}</p>}

        <div className="help-hero-actions">
          {primarySupportUrl && (
            <a className="help-primary-link" href={primarySupportUrl} target="_blank" rel="noreferrer">
              {content?.supportButtonLabel || 'Связаться с поддержкой'}
            </a>
          )}
          <Link className="help-secondary-link" to="/">
            Вернуться в каталог
          </Link>
        </div>
      </section>

      <section className="help-feature-grid">
        <article className="help-card help-card-accent">
          <p className="help-card-label">Поддержка</p>
          <h2>{content?.supportTitle || 'Написать в поддержку'}</h2>
          <p>{content?.supportDescription || 'Свяжитесь с нами через удобный мессенджер.'}</p>
          {primarySupportUrl && (
            <a className="help-inline-link" href={primarySupportUrl} target="_blank" rel="noreferrer">
              {content?.supportButtonLabel || 'Открыть поддержку'}
            </a>
          )}
        </article>

        <article className="help-card">
          <p className="help-card-label">Покупка</p>
          <h2>{content?.purchasesTitle || 'Как проходит покупка'}</h2>
          <p>{content?.purchasesDescription || 'После оплаты вы получите дальнейшие инструкции.'}</p>
          {content?.purchasesButtonUrl && (
            <a className="help-inline-link" href={content.purchasesButtonUrl} target="_blank" rel="noreferrer">
              {content?.purchasesButtonLabel || 'Перейти к оплате'}
            </a>
          )}
        </article>
      </section>

      {contactLinks.length > 0 && (
        <section className="help-section">
          <div className="help-section-head">
            <h2>Где быстрее ответим</h2>
            <p>Выберите удобный канал связи. Все ссылки меняются из админки.</p>
          </div>

          <div className="help-contact-grid">
            {contactLinks.map((item) => (
              <a
                key={item.key}
                className="help-contact-card"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="help-contact-icon">{item.icon}</span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.url.replace(/^https?:\/\//i, '')}</small>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {steps.length > 0 && (
        <section className="help-section">
          <div className="help-section-head">
            <h2>Пошагово</h2>
            <p>Краткая схема покупки и получения заказа.</p>
          </div>

          <div className="help-steps-grid">
            {steps.map((item, index) => (
              <article key={`${item.title}-${index}`} className="help-step-card">
                <span className="help-step-index">{String(index + 1).padStart(2, '0')}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {faqItems.length > 0 && (
        <section className="help-section">
          <div className="help-section-head">
            <h2>Частые вопросы</h2>
            <p>Самые частые вопросы тоже можно редактировать из админки.</p>
          </div>

          <div className="help-faq-list">
            {faqItems.map((item, index) => (
              <details key={`${item.question}-${index}`} className="help-faq-item">
                <summary>{item.question}</summary>
                <div className="help-faq-answer">{item.answer}</div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
