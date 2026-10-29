import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Terminal, Eye, EyeOff, Lock, Mail, Shield, Loader2, Sun, Moon } from 'lucide-react';
import { api } from '@/utils/api';
import { useAppStore } from '@/store/appStore';
import { APP_VERSION } from '@/version';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export function LoginPage() {
  const navigate = useNavigate();
  const { setUser, theme, setTheme } = useAppStore();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [requiresMFA, setRequiresMFA] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'register') {
        const res: any = await api.auth.register(email, password);
        if (res.token) {
          localStorage.setItem('terminalsql_token', res.token);
        }
        setUser(res.user);
        toast.success('Account created successfully');
        navigate('/');
      } else {
        const res: any = await api.auth.login(email, password, requiresMFA ? totpCode : undefined);
        if (res.requiresMFA) {
          setRequiresMFA(true);
          toast('Enter your 2FA verification code', { icon: '🔐' });
        } else {
          if (res.token) {
            localStorage.setItem('terminalsql_token', res.token);
          }
          setUser(res.user);
          toast.success('Welcome back');
          navigate('/');
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background text-foreground relative">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Light' : 'Dark'}
          aria-label={theme === 'dark' ? 'Light' : 'Dark'}
          className="text-muted-foreground hover:text-foreground hover:bg-muted h-8 w-8"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-sky-400" />
          )}
        </Button>
      </div>

      <Card className="w-full max-w-sm border-border bg-card/90 backdrop-blur-md shadow-2xl rounded-xl">
        <CardHeader className="text-center space-y-2 pb-5 pt-6">
          <div className="mx-auto w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <Terminal className="w-5 h-5" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight text-foreground flex items-center justify-center gap-2">
            TerminalSQL
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border bg-muted text-muted-foreground font-mono font-normal">
              {APP_VERSION}
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            SSH Terminal · SQL Query Editor · SFTP Manager
          </CardDescription>
        </CardHeader>

        <CardContent className="px-6 pb-6">
          {requiresMFA ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center space-y-1.5 pb-1">
                <div className="w-9 h-9 mx-auto rounded-full bg-muted flex items-center justify-center text-foreground">
                  <Shield className="w-4 h-4" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter the 6-digit verification code from your authenticator app
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="2fa-code" className="text-xs font-medium text-foreground">
                  2FA Verification Code
                </Label>
                <Input
                  id="2fa-code"
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="font-mono text-center tracking-[0.3em] text-lg h-10 bg-background border-border text-foreground focus-visible:ring-ring"
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium h-9 text-xs"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : 'Verify'}
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => setRequiresMFA(false)}
                className="w-full text-xs text-muted-foreground hover:text-foreground h-8"
              >
                Back to login
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-foreground">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="pl-8 bg-background border-border text-foreground placeholder:text-muted-foreground h-9 text-xs focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? 'Min. 8 characters' : '••••••••'}
                    required
                    className="pl-8 pr-9 bg-background border-border text-foreground placeholder:text-muted-foreground h-9 text-xs focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium h-9 text-xs transition-colors shadow-sm"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                ) : mode === 'login' ? (
                  'Sign In'
                ) : (
                  'Create Account'
                )}
              </Button>

              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <Separator className="bg-border" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-card px-2 text-muted-foreground font-mono">or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="w-full border-border bg-transparent hover:bg-muted text-foreground h-9 text-xs transition-colors"
              >
                {mode === 'login'
                  ? "Don't have an account? Register"
                  : 'Already have an account? Login'}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="px-6 pb-5 pt-0">
          <div className="w-full p-2.5 rounded-lg bg-muted/50 border border-border flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
            <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
            <span>AES-256-GCM encrypted · HttpOnly session cookies</span>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
