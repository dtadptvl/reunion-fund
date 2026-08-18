import React from 'react';
import { formatVND } from '../utils/format.js';

export interface FundGoalProgressProps {
  totalIncome: number;
  suggestedAmount?: number;
  targetAmount?: number;
  className?: string;
}

export const FundGoalProgress: React.FC<FundGoalProgressProps> = ({
  totalIncome = 0,
  suggestedAmount,
  targetAmount: customTarget,
  className = '',
}) => {
  // Safe calculation of target: suggestedAmount * 18 or customTarget or default 500k * 18
  const baseSuggested = suggestedAmount && suggestedAmount > 0 ? suggestedAmount : 500000;
  const target = customTarget && customTarget > 0 ? customTarget : baseSuggested * 18;

  const validIncome = Math.max(0, isNaN(totalIncome) ? 0 : totalIncome);
  const progressPercent = target > 0 ? (validIncome / target) * 100 : 0;
  const roundedPercent = Math.round(progressPercent);
  const overGoalPercent = Math.max(0, roundedPercent - 100);

  // Visual Bar Width: for bar fill, we cap bar fill at 100% (with fire styling extending across when overgoal)
  const barFillWidth = Math.min(100, progressPercent);

  // Determine Fire / Goal Tier
  const isGoalReached = progressPercent >= 100;
  const isOverGoal = progressPercent > 100;

  // Fire intensity tiers
  let tierClass = 'tier-normal';
  let badgeText = `${roundedPercent}%`;
  let statusTitle = 'Mục tiêu quỹ';
  let flameIcon = '🎯';

  if (!isGoalReached) {
    statusTitle = 'Mục tiêu quỹ';
    flameIcon = '🎯';
    badgeText = `${roundedPercent}%`;
    tierClass = 'tier-normal';
  } else if (roundedPercent === 100) {
    statusTitle = '🎉 Đã đạt mục tiêu!';
    flameIcon = '🎉';
    badgeText = '100%';
    tierClass = 'tier-reached';
  } else if (progressPercent <= 110) {
    // 100 - 110%: Subtle
    statusTitle = `🔥 Vượt mục tiêu ${overGoalPercent}%`;
    flameIcon = '🔥';
    badgeText = `${roundedPercent}%`;
    tierClass = 'tier-fire-1';
  } else if (progressPercent <= 130) {
    // >110 - 130%: Moderate
    statusTitle = `🔥🔥 Vượt mục tiêu ${overGoalPercent}%`;
    flameIcon = '🔥🔥';
    badgeText = `${roundedPercent}%`;
    tierClass = 'tier-fire-2';
  } else if (progressPercent <= 160) {
    // >130 - 160%: Strong
    statusTitle = `🔥🔥🔥 Vượt mục tiêu ${overGoalPercent}%`;
    flameIcon = '🔥🔥🔥';
    badgeText = `${roundedPercent}%`;
    tierClass = 'tier-fire-3';
  } else {
    // >160%: Supercharged
    statusTitle = `⚡ Vượt mục tiêu ${overGoalPercent}%`;
    flameIcon = '⚡🔥🔥';
    badgeText = `${roundedPercent}%`;
    tierClass = 'tier-fire-4';
  }

  return (
    <div className={`fund-goal-container ${tierClass} ${className}`}>
      {/* Header Info */}
      <div className="fund-goal-header">
        <div className="fund-goal-title-group">
          <span className="fund-goal-icon" aria-hidden="true">
            {flameIcon}
          </span>
          <span className="fund-goal-title">{statusTitle}</span>
        </div>

        <div className="fund-goal-amounts">
          <span className="fund-goal-current">{formatVND(validIncome)}</span>
          <span className="fund-goal-divider">/</span>
          <span className="fund-goal-target">{formatVND(target)}</span>
        </div>
      </div>

      {/* Progress Track & Bar */}
      <div
        className="fund-goal-track"
        role="progressbar"
        aria-valuenow={roundedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tiến độ mục tiêu quỹ"
      >
        <div
          className="fund-goal-bar"
          style={{ width: `${barFillWidth}%` }}
        >
          {isOverGoal && <div className="fund-goal-fire-shimmer" aria-hidden="true" />}
        </div>
      </div>

      {/* Footer / Caption */}
      <div className="fund-goal-footer">
        <span className="fund-goal-subtitle">
          {isGoalReached
            ? `Tuyệt vời! Quỹ đã hoàn thành ${roundedPercent}% kế hoạch`
            : `Đã hoàn thành ${roundedPercent}% tiến độ`}
        </span>
        <span className="fund-goal-badge">{badgeText}</span>
      </div>
    </div>
  );
};
