/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
        extend: {
                /* Beattribe Brand Colors */
                colors: {
                        /* Beattribe specific colors */
                        bt: {
                                background: '#000000',
                                primary: '#8A2EFF',
                                secondary: '#FF2FB3',
                                surface: 'rgba(20, 20, 25, 0.85)',
                                'surface-solid': '#14141A',
                        },
                        /* Standard shadcn tokens mapped to Beattribe */
                        background: 'hsl(var(--background))',
                        foreground: 'hsl(var(--foreground))',
                        card: {
                                DEFAULT: 'hsl(var(--card))',
                                foreground: 'hsl(var(--card-foreground))'
                        },
                        popover: {
                                DEFAULT: 'hsl(var(--popover))',
                                foreground: 'hsl(var(--popover-foreground))'
                        },
                        primary: {
                                DEFAULT: 'hsl(var(--primary))',
                                foreground: 'hsl(var(--primary-foreground))'
                        },
                        secondary: {
                                DEFAULT: 'hsl(var(--secondary))',
                                foreground: 'hsl(var(--secondary-foreground))'
                        },
                        muted: {
                                DEFAULT: 'hsl(var(--muted))',
                                foreground: 'hsl(var(--muted-foreground))'
                        },
                        accent: {
                                DEFAULT: 'hsl(var(--accent))',
                                foreground: 'hsl(var(--accent-foreground))'
                        },
                        destructive: {
                                DEFAULT: 'hsl(var(--destructive))',
                                foreground: 'hsl(var(--destructive-foreground))'
                        },
                        border: 'hsl(var(--border))',
                        input: 'hsl(var(--input))',
                        ring: 'hsl(var(--ring))',
                },
                /* Beattribe Border Radius */
                borderRadius: {
                        lg: 'var(--radius)',
                        md: 'calc(var(--radius) - 2px)',
                        sm: 'calc(var(--radius) - 4px)',
                        bt: {
                                sm: '6px',
                                md: '12px',
                                lg: '16px',
                                xl: '24px',
                        }
                },
                /* Beattribe Font Families */
                fontFamily: {
                        'bt-heading': ['Space Grotesk', 'sans-serif'],
                        'bt-body': ['Inter', 'sans-serif'],
                },
                /* Beattribe Box Shadow */
                boxShadow: {
                        'bt-sm': '0 2px 8px rgba(0, 0, 0, 0.4)',
                        'bt-md': '0 4px 16px rgba(0, 0, 0, 0.5)',
                        'bt-lg': '0 8px 32px rgba(0, 0, 0, 0.6)',
                        'bt-glow': '0 4px 24px rgba(138, 46, 255, 0.25)',
                        'bt-glow-lg': '0 8px 32px rgba(138, 46, 255, 0.4), 0 0 60px rgba(255, 47, 179, 0.2)',
                },
                /* Beattribe Background Gradients */
                backgroundImage: {
                        'bt-gradient': 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)',
                        'bt-gradient-radial': 'radial-gradient(circle, #8A2EFF 0%, transparent 70%)',
                },
                /* Beattribe Keyframes */
                keyframes: {
                        'accordion-down': {
                                from: {
                                        height: '0'
                                },
                                to: {
                                        height: 'var(--radix-accordion-content-height)'
                                }
                        },
                        'accordion-up': {
                                from: {
                                        height: 'var(--radix-accordion-content-height)'
                                },
                                to: {
                                        height: '0'
                                }
                        },
                        'bt-pulse-glow': {
                                '0%, 100%': {
                                        opacity: '0.6',
                                        transform: 'scale(1)'
                                },
                                '50%': {
                                        opacity: '1',
                                        transform: 'scale(1.05)'
                                }
                        },
                        'bt-float': {
                                '0%, 100%': {
                                        transform: 'translateY(0)'
                                },
                                '50%': {
                                        transform: 'translateY(-10px)'
                                }
                        },
                        'bt-fade-in': {
                                from: {
                                        opacity: '0',
                                        transform: 'translateY(20px)'
                                },
                                to: {
                                        opacity: '1',
                                        transform: 'translateY(0)'
                                }
                        }
                },
                /* Beattribe Animations */
                animation: {
                        'accordion-down': 'accordion-down 0.2s ease-out',
                        'accordion-up': 'accordion-up 0.2s ease-out',
                        'bt-pulse-glow': 'bt-pulse-glow 3s ease-in-out infinite',
                        'bt-float': 'bt-float 6s ease-in-out infinite',
                        'bt-fade-in': 'bt-fade-in 0.6s ease-out forwards'
                }
        }
  },
  plugins: [require("tailwindcss-animate")],
};