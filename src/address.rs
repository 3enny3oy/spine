use std::collections::BTreeSet;
use std::fmt;
use std::str::FromStr;

use crate::error::{AddressParseError, Error, ExpressionParseError};
use crate::signal::Specificity;

const ALLOWED_SEGMENT_CHARS: &str =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Address(String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AddressExpression {
    canonical: String,
    segments: Vec<ExpressionSegment>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ExpressionSegment {
    Literal(String),
    Dynamic(String),
    Wildcard,
    RecursiveWildcard,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Params(pub(crate) std::collections::BTreeMap<String, String>);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    pub expression: AddressExpression,
    pub address: Address,
    pub params: Params,
    pub specificity: Specificity,
}

impl Address {
    pub fn parse(input: impl AsRef<str>) -> Result<Self, AddressParseError> {
        parse_address(input.as_ref())
            .map(|canonical| Address(canonical))
            .map_err(|reason| AddressParseError::new(input.as_ref(), reason))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn segments(&self) -> impl Iterator<Item = &str> {
        self.0.split('/')
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for Address {
    type Err = AddressParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl AsRef<str> for Address {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl AddressExpression {
    pub fn parse(
        input: impl AsRef<str>,
        allow_catch_all: bool,
    ) -> Result<Self, ExpressionParseError> {
        parse_expression(input.as_ref(), allow_catch_all)
            .map_err(|reason| ExpressionParseError::new(input.as_ref(), reason))
    }

    pub fn as_str(&self) -> &str {
        &self.canonical
    }

    pub fn segments(&self) -> &[ExpressionSegment] {
        &self.segments
    }

    pub fn match_address(&self, address: &Address, registration_order: usize) -> Option<Match> {
        match_expression(self, address, registration_order)
    }
}

impl fmt::Display for AddressExpression {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.canonical)
    }
}

impl AsRef<str> for AddressExpression {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Params {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

pub(crate) fn match_expression(
    expression: &AddressExpression,
    address: &Address,
    registration_order: usize,
) -> Option<Match> {
    let address_segments: Vec<&str> = address.segments().collect();
    let mut params = std::collections::BTreeMap::new();
    let mut ai = 0usize;
    let mut literal_segments = 0usize;
    let mut dynamic_segments = 0usize;
    let mut wildcard_segments = 0usize;
    let mut recursive_segments = 0usize;
    let mut recursive_consumed = 0usize;

    for (ei, segment) in expression.segments.iter().enumerate() {
        match segment {
            ExpressionSegment::Literal(lit) => {
                let Some(actual) = address_segments.get(ai) else {
                    return None;
                };
                if actual != lit {
                    return None;
                }
                literal_segments += 1;
                ai += 1;
            }
            ExpressionSegment::Dynamic(name) => {
                let Some(actual) = address_segments.get(ai) else {
                    return None;
                };
                if params.contains_key(name) {
                    return None;
                }
                params.insert(name.clone(), (*actual).to_string());
                dynamic_segments += 1;
                ai += 1;
            }
            ExpressionSegment::Wildcard => {
                if address_segments.get(ai).is_none() {
                    return None;
                }
                wildcard_segments += 1;
                ai += 1;
            }
            ExpressionSegment::RecursiveWildcard => {
                if ei + 1 != expression.segments.len() {
                    return None;
                }
                recursive_segments += 1;
                recursive_consumed = address_segments.len().saturating_sub(ai);
                ai = address_segments.len();
            }
        }
    }

    if ai != address_segments.len() {
        return None;
    }

    Some(Match {
        expression: expression.clone(),
        address: address.clone(),
        params: Params(params),
        specificity: Specificity {
            literal_segments,
            dynamic_segments,
            wildcard_segments,
            recursive_segments,
            recursive_consumed,
            registration_order,
        },
    })
}

pub(crate) fn parse_address(input: &str) -> Result<String, String> {
    if input.is_empty() {
        return Err("address is empty".into());
    }
    if input.starts_with('/') || input.ends_with('/') {
        return Err("leading or trailing slash is not allowed".into());
    }
    if input.contains("//") {
        return Err("empty segments are not allowed".into());
    }

    let segments = split_segments(input)?;
    if segments.is_empty() {
        return Err("address must contain at least one segment".into());
    }

    for segment in &segments {
        validate_address_segment(segment)?;
    }

    Ok(segments.join("/"))
}

pub(crate) fn parse_expression(
    input: &str,
    allow_catch_all: bool,
) -> Result<AddressExpression, String> {
    if input.is_empty() {
        return Err("expression is empty".into());
    }
    if input.starts_with('/') || input.ends_with('/') {
        return Err("leading or trailing slash is not allowed".into());
    }
    if input.contains("//") {
        return Err("empty segments are not allowed".into());
    }

    let raw_segments = split_segments(input)?;
    if raw_segments.is_empty() {
        return Err("expression must contain at least one segment".into());
    }

    let mut segments = Vec::with_capacity(raw_segments.len());
    let mut seen_dynamic = BTreeSet::new();
    for (index, raw) in raw_segments.iter().enumerate() {
        let seg = if *raw == "*" {
            ExpressionSegment::Wildcard
        } else if *raw == "**" {
            if !allow_catch_all {
                return Err("catch-all expressions are disabled".into());
            }
            if index + 1 != raw_segments.len() {
                return Err("recursive wildcard must be final".into());
            }
            ExpressionSegment::RecursiveWildcard
        } else if raw.starts_with('{') && raw.ends_with('}') {
            let name = &raw[1..raw.len() - 1];
            validate_dynamic_name(name)?;
            if !seen_dynamic.insert(name.to_string()) {
                return Err(format!("duplicate dynamic variable name: {name}"));
            }
            ExpressionSegment::Dynamic(name.to_string())
        } else {
            validate_expression_literal(raw)?;
            ExpressionSegment::Literal((*raw).to_string())
        };
        segments.push(seg);
    }

    Ok(AddressExpression {
        canonical: segments_to_string(&segments),
        segments,
    })
}

fn split_segments(input: &str) -> Result<Vec<&str>, String> {
    let segments: Vec<&str> = input.split('/').collect();
    if segments.iter().any(|segment| segment.is_empty()) {
        return Err("empty segments are not allowed".into());
    }
    Ok(segments)
}

fn validate_address_segment(segment: &str) -> Result<(), String> {
    if segment == "." || segment == ".." {
        return Err("traversal-like segments are not allowed".into());
    }
    if segment.chars().any(|c| !ALLOWED_SEGMENT_CHARS.contains(c)) {
        return Err(format!("invalid address segment: {segment}"));
    }
    if segment.contains('{') || segment.contains('}') || segment.contains('*') {
        return Err("address may not contain expression syntax".into());
    }
    Ok(())
}

fn validate_expression_literal(segment: &str) -> Result<(), String> {
    if segment == "." || segment == ".." {
        return Err("traversal-like segments are not allowed".into());
    }
    if segment.chars().any(|c| !ALLOWED_SEGMENT_CHARS.contains(c)) {
        return Err(format!("invalid expression literal: {segment}"));
    }
    if segment.contains('{') || segment.contains('}') || segment.contains('*') {
        return Err("literal expression segments may not contain expression syntax".into());
    }
    Ok(())
}

fn validate_dynamic_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("dynamic variable name is empty".into());
    }
    if name == "." || name == ".." {
        return Err("traversal-like variable names are not allowed".into());
    }
    if name.chars().any(|c| !ALLOWED_SEGMENT_CHARS.contains(c)) {
        return Err(format!("invalid dynamic variable name: {name}"));
    }
    Ok(())
}

fn segments_to_string(segments: &[ExpressionSegment]) -> String {
    let mut out = String::new();
    for (index, segment) in segments.iter().enumerate() {
        if index > 0 {
            out.push('/');
        }
        match segment {
            ExpressionSegment::Literal(s) => out.push_str(s),
            ExpressionSegment::Dynamic(name) => {
                out.push('{');
                out.push_str(name);
                out.push('}');
            }
            ExpressionSegment::Wildcard => out.push('*'),
            ExpressionSegment::RecursiveWildcard => out.push_str("**"),
        }
    }
    out
}

impl From<AddressParseError> for Error {
    fn from(value: AddressParseError) -> Self {
        Error::AddressParse(value)
    }
}

impl From<ExpressionParseError> for Error {
    fn from(value: ExpressionParseError) -> Self {
        Error::ExpressionParse(value)
    }
}
