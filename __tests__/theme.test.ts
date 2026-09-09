import { theme } from '@/constants/theme';

describe('application theme', () => {
  it('registers the local button variants used by application actions', () => {
    expect(theme.components.Button).toMatchObject({
      defaultProps: {
        size: 'md',
        variant: 'outline'
      },
      variants: {
        primary: {
          backgroundColor: 'myGray.900',
          color: 'white'
        },
        base: {
          backgroundColor: 'myWhite.600',
          color: 'myGray.900'
        }
      }
    });
  });
});
