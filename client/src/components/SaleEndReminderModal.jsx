import React, { useState } from 'react';
import { subscribeSaleEndReminder } from '../services/api';

function formatDateRu(dateStr) {
  if (!dateStr) return dateStr;
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function SaleEndReminderModal({ dates, onClose, isLoggedIn, onNeedAuth }) {
  const [selected, setSelected] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const handleSend = async () => {
    if (!selected) return;
    if (!isLoggedIn) {
      onNeedAuth?.();
      onClose();
      return;
    }
    setSending(true);
    setError(null);
    try {
      await subscribeSaleEndReminder(selected);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при сохранении');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sale-reminder-backdrop" onClick={onClose}>
      <div className="sale-reminder-modal" onClick={(e) => e.stopPropagation()}>
        <button className="sale-reminder-close" onClick={onClose} aria-label="Закрыть">&times;</button>
        <h3 className="sale-reminder-title">Напоминание перед окончанием скидок</h3>
        <p className="sale-reminder-subtitle">
          Выберите дату окончания скидки — напоминание придёт только по играм с этой датой.
        </p>

        {sent ? (
          <div className="sale-reminder-success">
            Напоминание сохранено! Уведомим вас когда скидки на {formatDateRu(selected)} будут заканчиваться.
          </div>
        ) : (
          <>
            <div className="sale-reminder-list">
              {dates.length === 0 ? (
                <div className="sale-reminder-empty">Нет игр со скидками с известной датой окончания</div>
              ) : (
                dates.map((item) => (
                  <label
                    key={item.date}
                    className={`sale-reminder-item ${selected === item.date ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="sale-end-date"
                      value={item.date}
                      checked={selected === item.date}
                      onChange={() => setSelected(item.date)}
                    />
                    <span className="sale-reminder-date">{formatDateRu(item.date)}</span>
                    <span className="sale-reminder-count">{item.productCount} {item.productCount === 1 ? 'товар' : 'товаров'}</span>
                  </label>
                ))
              )}
            </div>

            {error && <div className="sale-reminder-error">{error}</div>}

            <div className="sale-reminder-actions">
              <button className="sale-reminder-cancel" onClick={onClose}>Отмена</button>
              <button
                className="sale-reminder-send"
                disabled={!selected || sending}
                onClick={handleSend}
              >
                {sending ? 'Сохранение...' : '✈ Отправить напоминание'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
