import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RotateCcw, Sliders, Check } from 'lucide-react';

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: 'normal' | '500' | '600' | 'bold';
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  themePreset: 'putty' | 'dracula' | 'oneDark' | 'monokai';
  copyOnSelect: boolean;
  rightClickAction: 'menu' | 'paste';
}

export const TERMINAL_THEMES = {
  putty: {
    name: 'Pitch Black (Default)',
    background: '#000000',
    foreground: '#bbbbbb',
    cursor: '#00ff00',
    cursorAccent: '#000000',
    black: '#000000',
    red: '#bb0000',
    green: '#00bb00',
    yellow: '#bbbb00',
    blue: '#0000bb',
    magenta: '#bb00bb',
    cyan: '#00bbbb',
    white: '#bbbbbb',
    brightBlack: '#555555',
    brightRed: '#ff5555',
    brightGreen: '#55ff55',
    brightYellow: '#ffff55',
    brightBlue: '#5555ff',
    brightMagenta: '#ff55ff',
    brightCyan: '#55ffff',
    brightWhite: '#ffffff',
  },
  dracula: {
    name: 'Dracula Dark',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#50fa7b',
    cursorAccent: '#282a36',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  oneDark: {
    name: 'One Dark / Catppuccin',
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    cursorAccent: '#1e1e2e',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#cba6f7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#cba6f7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  monokai: {
    name: 'Monokai Pro',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    cursorAccent: '#272822',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
};

export const FONT_FAMILIES = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { label: 'Inconsolata', value: "'Inconsolata', monospace" },
  { label: 'Ubuntu Mono', value: "'Ubuntu Mono', monospace" },
  { label: 'Consolas', value: "'Consolas', monospace" },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'System Monospace', value: 'monospace' },
];

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  fontWeight: 'normal',
  cursorStyle: 'block',
  cursorBlink: true,
  themePreset: 'putty',
  copyOnSelect: true,
  rightClickAction: 'menu',
};

interface Props {
  settings: TerminalSettings;
  onSave: (settings: TerminalSettings) => void;
  onClose: () => void;
}

export function TerminalSettingsModal({ settings: initial, onSave, onClose }: Props) {
  const [form, setForm] = useState<TerminalSettings>({ ...initial });

  function update<K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    onSave(form);
    onClose();
  }

  function handleReset() {
    setForm({ ...DEFAULT_TERMINAL_SETTINGS });
  }

  const activeTheme = TERMINAL_THEMES[form.themePreset] || TERMINAL_THEMES.putty;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[540px] bg-zinc-900 border-zinc-800 text-zinc-100 rounded-xl p-5 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-2 pr-8">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            Terminal Appearance & Font Settings
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Customize typography, size, spacing, cursor, and color theme.
          </DialogDescription>
        </DialogHeader>

        {/* Live Preview Box */}
        <div
          className="rounded-lg p-3 my-2 border border-zinc-800 font-mono transition-all overflow-hidden"
          style={{
            backgroundColor: activeTheme.background,
            color: activeTheme.foreground,
            fontFamily: form.fontFamily,
            fontSize: `${form.fontSize}px`,
            lineHeight: form.lineHeight,
            fontWeight: form.fontWeight,
          }}
        >
          <div className="flex items-center gap-1.5 pb-2 mb-2 border-b border-zinc-800/80 text-[11px] text-zinc-500 font-sans select-none">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            <span className="ml-2 font-mono text-[10px]">Preview ({form.fontSize}px · {form.fontFamily.split(',')[0].replace(/'/g, '')})</span>
          </div>
          <div>
            <span style={{ color: activeTheme.green }}>root@server</span>
            <span style={{ color: activeTheme.foreground }}>:</span>
            <span style={{ color: activeTheme.blue }}>~</span>
            <span style={{ color: activeTheme.foreground }}># </span>
            <span>ls -la --color=auto</span>
          </div>
          <div className="text-[0.9em] mt-1 space-y-0.5">
            <div><span style={{ color: activeTheme.cyan }}>drwxr-xr-x</span>  4 root root 4096 Oct 27 15:40 <span style={{ color: activeTheme.blue }}>.config/</span></div>
            <div><span style={{ color: activeTheme.yellow }}>-rw-r--r--</span>  1 root root 8920 Oct 27 15:42 <span style={{ color: activeTheme.green }}>deploy.sh*</span></div>
            <div><span style={{ color: activeTheme.magenta }}>-rw-r--r--</span>  1 root root  512 Oct 27 15:45 <span style={{ color: activeTheme.foreground }}>server.log</span></div>
          </div>
          <div className="mt-1 flex items-center">
            <span style={{ color: activeTheme.green }}>root@server</span>
            <span style={{ color: activeTheme.foreground }}>:</span>
            <span style={{ color: activeTheme.blue }}>~</span>
            <span style={{ color: activeTheme.foreground }}># </span>
            <span
              className={`inline-block ml-0.5 ${form.cursorBlink ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: form.cursorStyle === 'block' ? activeTheme.cursor : 'transparent',
                borderBottom: form.cursorStyle === 'underline' ? `2px solid ${activeTheme.cursor}` : 'none',
                borderLeft: form.cursorStyle === 'bar' ? `2px solid ${activeTheme.cursor}` : 'none',
                width: form.cursorStyle === 'block' ? '0.6em' : '1px',
                height: '1.1em',
              }}
            />
          </div>
        </div>

        {/* Controls Grid */}
        <div className="space-y-4 py-2 text-xs">
          {/* Row 1: Font Family */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-zinc-300">Font Family</Label>
              <span className="text-[10px] text-zinc-500 font-mono">Modern coding fonts</span>
            </div>
            <Select
              value={form.fontFamily}
              onValueChange={(val) => update('fontFamily', val)}
            >
              <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs font-mono">
                <SelectValue placeholder="Select Font Family" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 text-xs">
                {FONT_FAMILIES.map((f) => (
                  <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Row 2: Font Size Slider & Stepper */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-zinc-300">Font Size: <span className="font-mono text-emerald-400 font-semibold">{form.fontSize}px</span></Label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => update('fontSize', Math.max(10, form.fontSize - 1))}
                  className="h-6 w-6 border-zinc-800 text-zinc-300 hover:text-white"
                >
                  -
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => update('fontSize', Math.min(26, form.fontSize + 1))}
                  className="h-6 w-6 border-zinc-800 text-zinc-300 hover:text-white"
                >
                  +
                </Button>
              </div>
            </div>
            <div className="pt-1">
              <input
                type="range"
                min={10}
                max={26}
                step={1}
                value={form.fontSize}
                onChange={(e) => update('fontSize', parseInt(e.target.value))}
                className="w-full accent-white h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-600 font-mono pt-1">
                <span>10px</span>
                <span>14px (default)</span>
                <span>18px</span>
                <span>26px</span>
              </div>
            </div>
          </div>

          {/* Row 3: Line Height & Font Weight */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Line Height</Label>
              <Select
                value={String(form.lineHeight)}
                onValueChange={(val) => update('lineHeight', parseFloat(val))}
              >
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 text-xs">
                  <SelectItem value="1.0">1.0 (Compact)</SelectItem>
                  <SelectItem value="1.15">1.15 (Tight)</SelectItem>
                  <SelectItem value="1.25">1.25 (Default)</SelectItem>
                  <SelectItem value="1.4">1.4 (Spacious)</SelectItem>
                  <SelectItem value="1.6">1.6 (Relaxed)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Font Weight</Label>
              <Select
                value={form.fontWeight}
                onValueChange={(val: any) => update('fontWeight', val)}
              >
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 text-xs">
                  <SelectItem value="normal">Normal (400)</SelectItem>
                  <SelectItem value="500">Medium (500)</SelectItem>
                  <SelectItem value="600">Semi Bold (600)</SelectItem>
                  <SelectItem value="bold">Bold (700)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 4: Cursor Style & Cursor Blink */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Cursor Style</Label>
              <Select
                value={form.cursorStyle}
                onValueChange={(val: any) => update('cursorStyle', val)}
              >
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 text-xs">
                  <SelectItem value="block">Block ( █ )</SelectItem>
                  <SelectItem value="underline">Underline ( _ )</SelectItem>
                  <SelectItem value="bar">Bar ( | )</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between p-2 rounded-md bg-zinc-950 border border-zinc-800 mt-5">
              <Label htmlFor="cur-blink" className="text-xs text-zinc-300 cursor-pointer">Cursor Blink</Label>
              <Switch
                id="cur-blink"
                checked={form.cursorBlink}
                onCheckedChange={(checked) => update('cursorBlink', checked)}
              />
            </div>
          </div>

          {/* Row 5: Color Theme Preset */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Color Palette Preset</Label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TERMINAL_THEMES).map(([key, t]) => {
                const isSelected = form.themePreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update('themePreset', key as any)}
                    className={`p-2 rounded-md border text-left flex items-center justify-between transition-all ${
                      isSelected
                        ? 'border-white bg-zinc-800 text-white shadow-sm'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border border-zinc-700" style={{ backgroundColor: t.background }} />
                      <span className="text-[11px] font-mono">{t.name}</span>
                    </div>
                    {isSelected && <Check className="w-3 h-3 text-emerald-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 6: Native Desktop & Mouse Behavior */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-zinc-800/80">
            <div className="flex items-center justify-between p-2 rounded-md bg-zinc-950 border border-zinc-800">
              <div className="space-y-0.5">
                <Label htmlFor="copy-select" className="text-xs text-zinc-300 cursor-pointer">Copy on Select</Label>
                <p className="text-[10px] text-zinc-500 font-mono">Auto-copy highlighted text</p>
              </div>
              <Switch
                id="copy-select"
                checked={form.copyOnSelect}
                onCheckedChange={(checked) => update('copyOnSelect', checked)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Right-Click Action</Label>
              <Select
                value={form.rightClickAction}
                onValueChange={(val: any) => update('rightClickAction', val)}
              >
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 text-xs">
                  <SelectItem value="menu">Native Context Menu</SelectItem>
                  <SelectItem value="paste">Direct Paste (PuTTY)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-zinc-800 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-zinc-400 hover:text-white h-8 text-xs gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-zinc-800 text-zinc-400 hover:text-white h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              className="bg-white hover:bg-zinc-200 text-zinc-950 font-medium h-8 text-xs px-4"
            >
              Apply Settings
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
