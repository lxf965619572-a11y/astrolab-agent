// 触感按键：凸起表示可以按，按下陷进去；主按钮是浅紫底深紫字。按下/松开/拖出取消、键盘空格回车都由 React Aria 统一处理。

import { Button, type ButtonProps, Switch as AriaSwitch, type SwitchProps } from 'react-aria-components'
import { play } from '../sound'

type KeyProps = ButtonProps & { variant?: 'key' | 'primary' | 'ghost' | 'cap'; size?: 'sm' | 'md' | 'lg'; className?: string }

export function Key({ variant = 'key', size = 'md', className = '', onPressStart, ...rest }: KeyProps) {
  return (
    <Button
      {...rest}
      onPressStart={(e) => { play('tick'); onPressStart?.(e) }}
      className={`k k-${variant} k-${size} ${className}`}
    />
  )
}

export function Toggle({ children, ...rest }: SwitchProps & { children?: React.ReactNode }) {
  return (
    <AriaSwitch {...rest} className="sw">
      <span className="sw-track" aria-hidden="true"><span className="sw-knob" /></span>
      {children && <span className="sw-label">{children}</span>}
    </AriaSwitch>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="kbd">{children}</span>
}
