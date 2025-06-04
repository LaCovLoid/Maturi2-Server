import express, { json, Request, Response, urlencoded } from "express";
import { createConnection } from "mysql2/promise";
import dotenv from "dotenv";
import crypto from "crypto";
import axios, { Axios, AxiosResponse } from "axios";
import cors from "cors";
import * as deepl from "deepl-node";
import passport from "passport";
import { Strategy as KakaoStrategy } from "passport-kakao";
import session from "express-session";
import generateJWT from "jsonwebtoken";

import { Festival, FestivalDate } from "../type";

dotenv.config();
connectServer();

//https://chatgpt.com/c/67a49d58-5f48-800e-8345-2cf33ef268d8

const clientURL: string = String(process.env.CLIENT_URL);
const app: express.Application = express();
const port: number = 3000;
let connection: any;

passport.use(
  new KakaoStrategy(
    {
      clientID: String(process.env.KAKAO_KEY),
      clientSecret: "", // 선택사항
      callbackURL: "http://localhost:3000/auth/kakao/callback", // 링크 변수로 따로 빼내기
    },
    (accessToken, refreshToken, profile, done) => {
      // 사용자 정보 처리
      //console.log("Kakao Profile:", profile); ///////////유저 정보 여기서 나오네
      done(null, profile);
    }
  )
);
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((user: any, done) => {
  done(null, user);
});

app.use(cors());
app.use(json());
app.use(urlencoded({ extended: true }));
app.use(
  session({
    secret: String(process.env.SSESION_SECRET_KEY), // 세션 암호화에 사용할 키 (환경 변수로 관리 추천)
    resave: false, // 매 요청마다 세션을 강제로 저장하지 않음
    saveUninitialized: false, // 초기화되지 않은 세션을 저장하지 않음
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 세션 유지 시간 (여기서는 하루)
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

async function connectServer() {
  connection = await createConnection({
    host: process.env.DB_HOST, // 'localhost',
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  console.log("connection successful?", connection != null);
}

//setInterval(updateHandler, 3600000); 1시간마다 한번씩 반복실행
// 나중에 접속을 못하게 하고 db업데이트용 함수로만 실행

app.get("/update", updateHandler);
async function updateHandler(req: express.Request, res: express.Response) {
  if (connection == null) return;

  let allFestival: Festival[] = [];
  const monthCount: number = 4;

  try {
    for (let i: number = 0; i < monthCount; i++) {
      const response: AxiosResponse = await axios.get(getLink(i, 1));
      if (!response || !response.data) return;

      let responseData: string = response.data;
      let maxPage: string = responseData
        .split("m-pager__current")[1]
        .split("/")[2]
        .split("（全")[0];

      if (isNaN(Number(maxPage))) {
        res.status(404).send({ reason: "SourcePage Loading Error" });
        return;
      }
      for (let j = 1; j < Number(maxPage) + 1; j++) {
        allFestival = allFestival.concat(await getListFromPage(getLink(i, j)));
      }
    }

    allFestival = removeDuplicates(allFestival);
    res.send(allFestival);
  } catch (error: unknown) {
    console.error("Error while updating:", error);
    res.status(500).send({
      reason: "Internal Server Error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

app.get("/auth/kakao", passport.authenticate("kakao"));

app.get(
  "/auth/kakao/callback",
  passport.authenticate("kakao", {
    failureRedirect: `${clientURL}?matsuri_login_token=`,
  }),
  (req: Request, res: Response) => {
    const user = req.user; // 로그인 후 사용자 정보
    const frontendURL = `${clientURL}/auth/callback`;

    // JWT 토큰 생성
    const matsuri_login_token = generateJWT.sign(
      { user },
      String(process.env.JWT_SECRET_KEY),
      { expiresIn: "1h" }
    );
    console.log(user);

    // 프론트엔드로 리디렉트하면서 쿼리스트링으로 데이터 전달
    res.redirect(`${frontendURL}?matsuri_login_token=${matsuri_login_token}`);
  }
);

////////////////////////////////////////////////////
////////////////////////////////////////////////////
////////////////////////////////////////////////////

async function getListFromPage(link: string): Promise<Festival[]> {
  const response: AxiosResponse<any> = await axios.get(link);
  if (!response || !response.data) {
    return [];
  }

  let list: string[] = response.data.split('"m-mainlist-item"');
  let result: Festival[] = [];
  for (let i = 1; i < list.length; i++) {
    let info: Festival = getInfo(list[i]);
    result.push(info);
  }
  return result;
}

function removeDuplicates(list: Festival[]): Festival[] {
  let result: Festival[] = [];
  return Array.from(
    new Map(list.map((festival) => [festival.id, festival])).values()
  );
}

function getLink(monthIncrease: number, page: number): string {
  const now: Date = new Date(); // 현재 날짜
  let month: number = now.getMonth() + 1 + monthIncrease; // 0 = 1월
  if (month > 12) month = month % 12;

  const link =
    "https://www.walkerplus.com/event_list/" +
    (month < 10 ? "0" : "") +
    String(month) +
    "/eg0135/" +
    String(page) +
    ".html";

  return link;
}

function getInfo(text: string): Festival {
  let id: string = text.split("event/")[1].split("/")[0].trim();

  // 이름 title
  let title: string = text
    .split('m-mainlist-item__ttl">')[1]
    .split("</span")[0]
    .trim();

  // 썸네일 thumbnail
  let thumbnail: string = text.split('img src="')[1].split('"')[0];

  // 날짜 date, startDate, endDate
  // 하반 중반 상반의 경우 표기

  let displayDate: string = "";
  let date: string = "";

  if (text.includes("m-mainlist-item-event__open")) {
    date = text
      .split("m-mainlist-item-event__open")[1]
      .replace('<span class="m-mainlist-item-event__end">終了間近</span>', "")
      .split('"')[1]
      .split('"')[0]
      .split("</span>")[1]
      .split("</p>")[0]
      .trim();
  } else {
    date = text
      .split("m-mainlist-item-event__period")[1]
      .replace('<span class="m-mainlist-item-event__end">終了間近</span>', "")
      .split('">')[1]
      .split("</p>")[0]
      .trim();
  }

  // 상반 중반 하반 표기시 평균값 날짜로 대체

  if (date.includes("旬")) {
    displayDate = date;

    if (date.includes("上旬")) {
      date = date.replace(/上旬/g, "5日");
    }
    if (date.includes("中旬")) {
      date = date.replace(/中旬/g, "15日");
    }
    if (date.includes("下旬")) {
      date = date.replace(/下旬/g, "25日");
    }
  }

  


  //쿼리넣기 따로따로
  // INSERT IGNORE INTO 로 넣으면 UNIQUE KEY값이 같을경우 안들어감
  //INSERT IGNORE INTO 테이블 VALUES ON DUPLICATE KEY UPDATE ('값1', '값2') 해주면 UNIQUE KEY값이 같으면 업데이트함

  // 받아온 축제를 전부 duplicate insert로 작성
  // 그와 동시에 기간과 태그를 축제id로 연동해 작성
  // schedule db는 여기 date부분에서 삽입,??이 맞나? 한번에 같이해야하는데 어카지.

  // 상세설명은 vue3 클라이언트에서 번역사용
  // 서버쪽에서 번역해줘야할건 표기할때 같이 표기하기위한 축제이름,  태그(다른테이블)

  // 카카오톡 로그인 만들기
  // 축제db에 한국어이름 번역, 클릭된 count 추가 ++ 도시가 아니라 ~현 임. 영어검색해서 수정


  // 기간을 switch로 나눠서 

  const year: number = Number(date.split("年")[0]);
  const month: number = Number(date.split("年")[1].split("月")[0]) - 1; // 0 = 1월 
  const day: number = Number(date.split("月")[1].split("日")[0]);
  
  switch (true) {
    case /～/.test(date): // 기간동안 하는 경우
      break;
    case /・/.test(date): // 이틀간 할 경우
      break;
    default: //기한이 없을경우
      break;
  }

  /*
  // date를 여기에 저장할 것 << 결과로만 쓰면 됨
  let festivalDate: FestivalDate = {
    startYear: 0,
    startMonth: 0,
    startDay: 0,
  };
*/

/* chat gpt가 알려준 코드
export interface FestivalDate {
  start: Date;
  end?: Date;
  displayDate?: string;
}

// 메인 파서 함수
export function parseFestivalDate(raw: string): FestivalDate[] {
  switch (true) {
    case /～/.test(raw): // 기간
      return parseRangeDate(raw);
    case /・/.test(raw): // 여러 날짜 분리
      return parseMultipleDates(raw);
    default: // 단일 날짜
      return parseSingleDate(raw);
  }
}

// 기간 파싱 (ex. "2025年6月6日(金)～9日(月)")
function parseRangeDate(raw: string): FestivalDate[] {
  const [startStr, endStr] = raw.split("～").map(str => str.trim());
  const start = parseJapaneseDate(startStr);
  const end = parseJapaneseDateRelative(endStr, start);
  return [{ start, end }];
}

// 여러 날짜 파싱 (ex. "2025年6月20日(金)・21日(土)")
function parseMultipleDates(raw: string): FestivalDate[] {
  const parts = raw.split("・").map(str => str.trim());
  const base = parseJapaneseDate(parts[0]);
  const results: FestivalDate[] = [{ start: base }];

  for (let i = 1; i < parts.length; i++) {
    const date = parseJapaneseDateRelative(parts[i], base);
    results.push({ start: date });
  }

  return results;
}

// 단일 날짜 파싱 (ex. "2025年6月5日(木)")
function parseSingleDate(raw: string): FestivalDate[] {
  return [{ start: parseJapaneseDate(raw) }];
}

// 완전한 날짜 파싱: "2025年6月6日(金)"
function parseJapaneseDate(dateStr: string): Date {
  const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) throw new Error(`날짜 파싱 실패: ${dateStr}`);

  const [, year, month, day] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

// 생략된 연/월 보정 (～나 ・ 뒤쪽에서 사용)
// base: Date 기준으로 년/월이 생략된 경우 보완
function parseJapaneseDateRelative(part: string, base: Date): Date {
  const yearMatch = part.match(/(\d{4})年/);
  const monthMatch = part.match(/(\d{1,2})月/);
  const dayMatch = part.match(/(\d{1,2})日/);

  const year = yearMatch ? parseInt(yearMatch[1]) : base.getFullYear();
  const month = monthMatch ? parseInt(monthMatch[1]) - 1 : base.getMonth();
  if (!dayMatch) throw new Error(`날짜(일) 파싱 실패: ${part}`);
  const day = parseInt(dayMatch[1]);

  return new Date(year, month, day);
}
*/ 

  // 개최 현 metropolis

  let metropolis: string = text
    .split("m-mainlist-item__maplink")[1]
    .split("</p>")[0]
    .split('">')[1]
    .split("</a>")[0]
    .trim();

  // 위치 locate

  let locate: string = "";
  if (text.split("m-mainlist-item__maplink").length == 3) {
    locate = text
      .split("m-mainlist-item__maplink")[2]
      .split("</p>")[0]
      .split('">')[1]
      .split("</a>")[0]
      .trim();
  } else {
    locate = text
      .split("m-mainlist-item__maplink")[1]
      .split("</p>")[0]
      .split("</a>")[1]
      .trim();
  }

  // 장소 place

  let place: string = text
    .split("m-mainlist-item-event__place")[1]
    .split("</p>")[0]
    .split(">")[1];

  // 태그 tagList

  let tagList: string[] = [];
  for (
    let j = 0;
    j < text.split("m-mainlist-item__tagsitemlink").length - 1;
    j++
  ) {
    let tag: string = text
      .split("m-mainlist-item__tagsitemlink")
      [j + 1].split("</")[0]
      .split('">')[1];
    tagList.push(tag);
  }

  const festival: Festival = {
    id: id,
    title: title,
    thumbnail: thumbnail,
    dates: date,
    metropolis: metropolis,
    locate: locate,
    place: place,
    tag: tagList,
    isFree: tagList.includes("入場無料"),
  };

  return festival;
}

function getFestivalPeriod(text: string, symbol: string): Date[] {
  let startYear: number = Number(text.split("年")[0]);
  let startMonth: number = Number(text.split("年")[1].split("月")[0]) - 1;
  if (startMonth == -1) startMonth = 11;
  let startDay: number = Number(text.split("月")[1].split("日")[0]);

  let startDate: Date = new Date(Date.UTC(startYear, startMonth, startDay));
  let endDate: Date = startDate;

  if (symbol == "=") {
    return [startDate, endDate];
  }

  if (/年/.test(text.split(symbol)[1])) {
    endDate = new Date(
      Date.UTC(
        Number(text.split(symbol)[1].split("年")[0]),
        Number(text.split(symbol)[1].split("年")[1].split("月")[0]) - 1,
        Number(text.split(symbol)[1].split("月")[1].split("日")[0])
      )
    );
  } else if (/月/.test(text.split(symbol)[1])) {
    endDate = new Date(
      Date.UTC(
        startYear,
        Number(text.split(symbol)[1].split("月")[0]) - 1,
        Number(text.split(symbol)[1].split("月")[1].split("日")[0])
      )
    );
  } else {
    endDate = new Date(
      Date.UTC(
        startYear,
        startMonth,
        Number(text.split(symbol)[1].split("日")[0])
      )
    );
  }
  return [startDate, endDate];
}
/*
app.get('/random', randomHandler);
async function randomHandler(req:any, res:any) {
  if (connection == null) return;
  
  let [result] = await connection.query("SELECT * FROM `words` WHERE `yomi_word_same`='0' Order by rand() Limit 1");
  if (result == null) {
    res.status(404).send({reason:"DB Error"});
  }
  res.send();
}
*/
/*
app.get('/translate', translateHandler);
async function translateHandler(req:any, res:any):Promise<any> {
  const authKey = String(process.env.authKey);
  const translator = new deepl.Translator(authKey);

  let text = req.query.text;
  let type = req.query.type;
  let startLanguage = '';
  let toLanguage = '';

  if (text == null) text = "안녕하세요";
  if (type == null) type = 0;

  if (type == 0) {
    startLanguage = 'ja';
    toLanguage = 'ko';
  }else {
    startLanguage = 'ko';
    toLanguage = 'ja';
  }
  translator.translateText(text, startLanguage as deepl.SourceLanguageCode, toLanguage as deepl.TargetLanguageCode)
    .then(deeplFetchHandler)
    .catch(deeplErrorHandler);

  function deeplErrorHandler() {
    res.status(404).send();
  }
  function deeplFetchHandler(response:any) {
    res.send(response.text);
  }
}
*/

//hash 암호화
function sha512Hash(str: string): string {
  return crypto.createHash("sha512").update(str).digest("hex");
}

function getCurrentMaturi(): string {
  const now: Date = new Date();
  let month: number = now.getMonth() + 1; // 0 = 1월
  if (month > 12) month = month % 12;
  let day: number = now.getDate();
  return String(month) + String(day);
}