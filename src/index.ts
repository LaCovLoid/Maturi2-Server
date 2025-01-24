import express, { json, Request, Response, urlencoded } from "express";
import { createConnection } from "mysql2/promise";
import dotenv from "dotenv";
import crypto from "crypto";
import axios, { Axios, AxiosResponse } from "axios";
import cors from "cors";
import * as deepl from "deepl-node";
import passport from "passport";
import { Strategy as KakaoStrategy } from "passport-kakao";

import { Festival } from "../type";

const app: express.Application = express();
const port: number = 3000;
let connection: any;

dotenv.config();
connectServer();

app.use(cors());
app.use(json());
app.use(urlencoded({ extended: true }));

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

////////////////////////////이 밑으론 카카오톡API////////////////////////

passport.use(
  new KakaoStrategy(
    {
      clientID: "YOUR_KAKAO_REST_API_KEY",
      clientSecret: "", // 선택사항
      callbackURL: "http://localhost:3000/auth/kakao/callback",
    },
    (accessToken, refreshToken, profile, done) => {
      // 사용자 정보 처리
      console.log("Kakao Profile:", profile);
      done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.serializeUser((user: any, done) => {
  done(null, user);
});

passport.deserializeUser((user: any, done) => {
  done(null, user);
});

// 라우팅
app.use(passport.initialize());

app.get("/auth/kakao", passport.authenticate("kakao"));

app.get(
  "/auth/kakao/callback",
  passport.authenticate("kakao", {
    failureRedirect: "/auth/fail",
  }),
  (req: Request, res: Response) => {
    res.redirect("/auth/success");
  }
);

app.get("/auth/success", (req: Request, res: Response) => {
  res.send("로그인 성공!");
});

app.get("/auth/fail", (req: Request, res: Response) => {
  res.send("로그인 실패!");
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

////////////////////////////////////////////////////
////////////////////////////////////////////////////
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

  let date: string;

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

  if (date.includes("旬")) {
    date = date.replace(/上旬/g, "5日");
    date = date.replace(/中旬/g, "15日");
    date = date.replace(/下旬/g, "25日");
  }

  let festivalPeriod: Date[] = [];

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

  switch (true) {
    case /～/.test(date): // 기간동안 하는 경우
      festivalPeriod = getFestivalPeriod(date, "～");
      break;
    case /・/.test(date): // 이틀간 할 경우
      festivalPeriod = getFestivalPeriod(date, "・");
      break;
    default: //기한이 없을경우
      festivalPeriod = getFestivalPeriod(date, "=");
      break;
  }

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
    date: String(date),
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

function sha512Hash(str: string): string {
  return crypto.createHash("sha512").update(str).digest("hex");
}
