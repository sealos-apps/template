import { theme } from '@/constants/theme';

describe('application theme', () => {
  it('restores the legacy button styles used by application actions', () => {
    const button = theme.components.Button;

    expect(button).toMatchObject({
      defaultProps: {
        size: 'md',
        variant: 'solid'
      },
      variants: {
        primary: {
          bg: '#3E3B3B',
          color: '#FEFEFE'
        }
      }
    });

    expect(button.variants.solid({ theme })).toMatchObject({
      bg: '#111824',
      color: '#FFF'
    });
    expect(button.variants.outline({ theme })).toMatchObject({
      bg: '#FFF',
      borderColor: 'grayModern.250',
      color: 'grayModern.600'
    });
  });
});
