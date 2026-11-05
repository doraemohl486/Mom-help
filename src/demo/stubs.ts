// 체험판에는 Claude API를 넣지 않는다 (규칙 기반 비서·문자 읽기 사용). 번들 크기를 줄이기 위한 빈 모듈.
export default class Anthropic {
  constructor() {
    throw new Error("체험판에서는 Claude API를 쓰지 않아요.");
  }
}
export function betaZodOutputFormat(): never {
  throw new Error("체험판에서는 Claude API를 쓰지 않아요.");
}
