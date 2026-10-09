#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <hfs/hfsplus.h>
int main(int argc, char **argv) {
  HFSUniStr255 s;
  char *out;
  unsigned int i;
  if(argc != 3) return 2;
  memset(&s, 0, sizeof s);
  if(strcmp(argv[1], "encode") == 0) {
    ASCIIToUnicode(argv[2], &s);
    printf("%u:", s.length);
    for(i=0; i<s.length; ++i) printf("%04x", s.unicode[i]);
    putchar('\n');
    out=unicodeToAscii(&s); puts(out); free(out);
    printUnicode(&s); putchar('\n');
  } else {
    char *p=argv[2];
    while(*p) { unsigned int v; if(sscanf(p,"%4x",&v)!=1) return 3; s.unicode[s.length++]=v; p+=4; }
    out=unicodeToAscii(&s); puts(out); free(out);
  }
  return 0;
}
