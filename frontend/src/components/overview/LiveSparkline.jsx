import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

const FALLBACK = [3, 5, 4, 7, 6, 8, 5, 9, 7, 10];

export default function LiveSparkline({ data, color = 'var(--info-strong)', height = 40 }) {
  const points = useMemo(() => {
    const src = data && data.length >= 2 ? data : FALLBACK;
    return src.map((v, i) => ({ i, v }));
  }, [data]);

  // Colours may now be `var(--token)`, so strip everything that isn't
  // id-safe rather than just the leading '#'.
  const gradId = `sg-${String(color).replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.28} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          content={() => null}
          cursor={false}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          animationDuration={800}
          isAnimationActive
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
