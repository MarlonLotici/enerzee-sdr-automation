import React from 'react';

const PERIODS = [
    { label: 'Hoje',   value: '1d' },
    { label: '7 dias', value: '7d' },
    { label: '30 dias',value: '30d' },
    { label: '90 dias',value: '90d' },
    { label: '1 ano',  value: '365d' },
    { label: 'Tudo',   value: 'all' },
];

export default function PeriodSelector({ value, onChange }) {
    return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PERIODS.map(p => (
                <button
                    key={p.value}
                    onClick={() => onChange(p.value)}
                    style={{
                        padding: '5px 14px',
                        borderRadius: 8,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 500,
                        background: value === p.value ? '#6366f1' : '#1e293b',
                        color: value === p.value ? '#fff' : '#94a3b8',
                        transition: 'background 0.15s, color 0.15s',
                    }}
                >
                    {p.label}
                </button>
            ))}
        </div>
    );
}
